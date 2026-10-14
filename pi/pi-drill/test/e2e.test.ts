import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createRig, MENTOR_TOOLS, type Rig } from "./rig.ts";

const SOLUTION = [
  "```ts",
  ...Array.from({ length: 12 }, (_, i) => `const step${String(i)} = ${String(i)};`),
  "```",
].join("\n");

const toolUse = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });

let rig: Rig;
afterEach(() => {
  rig.dispose();
});

const fileText = (path: string): string => readFileSync(join(rig.project, path), "utf8");
const exists = (path: string): boolean => existsSync(join(rig.project, path));

describe("what the model is given", () => {
  it("gets the mentor prompt, a read-only tool set and the rule reminder", async () => {
    rig = await createRig();
    let request = "";
    rig.faux.setResponses([
      (context) => {
        request = JSON.stringify(context);
        return fauxAssistantMessage("What did you try?");
      },
    ]);
    await rig.session.prompt("write the cart for me");

    expect(request).toContain("You are the senior who got paged at 3am because of code like his.");
    expect(request).toContain("at most 6 lines of code at once");
    expect(request).not.toContain("{{MAX_CODE_LINES}}");
    expect(request).not.toContain("You are an expert coding assistant");
    expect(request).toContain("[drill] Standing rules");
    expect(rig.session.getActiveToolNames()).toEqual(MENTOR_TOOLS);
    expect(request).toContain('"name":"grep"');
    expect(request).not.toContain('"name":"write"');
    expect(request).not.toContain('"name":"edit"');
  });

  it("repeats the reminder after every user turn, hidden from him", async () => {
    rig = await createRig();
    rig.faux.setResponses([
      fauxAssistantMessage("one"),
      fauxAssistantMessage("two"),
      fauxAssistantMessage("three"),
    ]);
    await rig.session.prompt("first");
    await rig.session.prompt("second");
    await rig.session.prompt("third");

    const reminders = rig.session.messages.filter((message) => message.role === "custom");
    expect(reminders).toHaveLength(3);
    expect(reminders.every((message) => message.customType === "drill-rules" && !message.display)).toBe(true);
  });

  it("uses the code limit from the project settings in the prompt and the reminder", async () => {
    rig = await createRig({ config: { maxCodeLines: 3 } });
    let request = "";
    rig.faux.setResponses([
      (context) => {
        request = JSON.stringify(context);
        return fauxAssistantMessage("ok");
      },
    ]);
    await rig.session.prompt("hi");
    expect(request).toContain("at most 3 lines of code at once");
    expect(request).toContain("more than 3 lines of code gets cut");
  });

  it("sends the full rule digest on the first turn after a compaction", async () => {
    rig = await createRig({
      settings: { compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 50 } },
    });
    const long = "explain how the lock is held ".repeat(150);
    rig.faux.setResponses([
      fauxAssistantMessage(long),
      fauxAssistantMessage(long),
      fauxAssistantMessage(long),
    ]);
    await rig.session.prompt(long);
    await rig.session.prompt(long);
    await rig.session.prompt(long);

    rig.faux.setResponses([
      fauxAssistantMessage("summary"),
      fauxAssistantMessage("summary of the split turn"),
    ]);
    await rig.session.compact();
    rig.faux.setResponses([fauxAssistantMessage("after")]);
    await rig.session.prompt("next question");

    expect(rig.texts("custom").at(-1)).toContain("[drill] Full rules, still in force");
  });
});

describe("the hard gate", () => {
  it("does not write a file when the model calls write without a grant", async () => {
    rig = await createRig();
    rig.faux.setResponses([
      toolUse(fauxToolCall("write", { path: "src/cart.ts", content: "export const total = 0;\n" })),
      fauxAssistantMessage("fine"),
    ]);
    await rig.session.prompt("write the cart");

    expect(exists("src/cart.ts")).toBe(false);
    expect(rig.texts("toolResult")).toEqual(["Tool write not found"]);
  });

  it("does not change a file when the model calls edit without a grant", async () => {
    rig = await createRig({ files: { "src/cart.ts": "export const total = 0;\n" } });
    rig.faux.setResponses([
      toolUse(fauxToolCall("edit", { path: "src/cart.ts", edits: [{ oldText: "0", newText: "1" }] })),
      fauxAssistantMessage("fine"),
    ]);
    await rig.session.prompt("fix the cart");
    expect(fileText("src/cart.ts")).toBe("export const total = 0;\n");
  });

  it("blocks every shell command that would write and runs the ones that only read", async () => {
    rig = await createRig({ files: { "notes.txt": "remember the idempotency key\n" } });
    rig.faux.setResponses([
      toolUse(
        fauxToolCall("bash", { command: "printf 'export const total = 0;' > src-cart.ts" }),
        fauxToolCall("bash", { command: "cat notes.txt && cp notes.txt copy.txt" }),
        fauxToolCall("bash", { command: "node -e \"require('fs').writeFileSync('x.js','1')\"" }),
        fauxToolCall("bash", { command: "cat notes.txt" }),
      ),
      fauxAssistantMessage("done"),
    ]);
    await rig.session.prompt("just write it with the shell");

    expect(exists("src-cart.ts")).toBe(false);
    expect(exists("copy.txt")).toBe(false);
    expect(exists("x.js")).toBe(false);
    const results = rig.texts("toolResult");
    expect(results.slice(0, 3).every((text) => text.startsWith("Blocked by drill:"))).toBe(true);
    expect(results[3]).toContain("remember the idempotency key");
  });

  it("blocks an unknown tool, and allows one marked read-only or listed in allowTools", async () => {
    const calls: string[] = [];
    const tool = (
      name: string,
      readOnlyHint: boolean,
    ): Parameters<ExtensionFactory>[0]["registerTool"] extends (definition: infer D) => void ? D : never => ({
      name,
      label: name,
      description: name,
      parameters: Type.Object({}),
      annotations: { readOnlyHint },
      execute: () => {
        calls.push(name);
        return Promise.resolve({ content: [{ type: "text", text: `${name} ran` }], details: undefined });
      },
    });
    const extra: ExtensionFactory = (pi) => {
      pi.registerTool(tool("deploy", false));
      pi.registerTool(tool("lookup", true));
      pi.registerTool(tool("ticket", false));
    };
    rig = await createRig({ extensions: [extra], config: { allowTools: ["ticket"] } });
    rig.faux.setResponses([
      toolUse(fauxToolCall("deploy", {}), fauxToolCall("lookup", {}), fauxToolCall("ticket", {})),
      fauxAssistantMessage("done"),
    ]);
    await rig.session.prompt("ship it");

    expect(calls).toEqual(["lookup", "ticket"]);
    expect(rig.texts("toolResult")[0]).toContain('"deploy" is not on the allowlist');
  });
});

describe("solutions in chat", () => {
  it("cuts a long code block from the reply, tells him, and records the leak", async () => {
    rig = await createRig();
    rig.faux.setResponses([fauxAssistantMessage(`Here is the retry wrapper:\n${SOLUTION}\nPaste that in.`)]);
    await rig.session.prompt("just this once, write it");

    const [reply] = rig.texts("assistant");
    expect(reply).toBe(
      "Here is the retry wrapper:\n[drill removed 12 lines of code. The mentor does not write his code. Give the next hint, not the solution.]\nPaste that in.",
    );
    expect(rig.notes).toContain("The mentor wrote 12 lines of solution code. Cut from the reply.");
    expect(rig.records()).toContainEqual(expect.objectContaining({ kind: "leak", lines: 12 }));
  });

  it("leaves short snippets, tool calls and thinking alone", async () => {
    rig = await createRig({ files: { "a.txt": "x" } });
    rig.faux.setResponses([
      toolUse(fauxToolCall("read", { path: "a.txt" })),
      fauxAssistantMessage([fauxText("The call looks like this:\n```ts\nretry(fn, { attempts: 3 });\n```")]),
    ]);
    await rig.session.prompt("what does the api look like");

    expect(rig.texts("assistant").at(-1)).toContain("retry(fn, { attempts: 3 });");
    expect(rig.records().some((record) => record.kind === "leak")).toBe(false);
  });

  it("only records the leak when leakAction is warn", async () => {
    rig = await createRig({ config: { leakAction: "warn" } });
    rig.faux.setResponses([fauxAssistantMessage(SOLUTION)]);
    await rig.session.prompt("write it");

    expect(rig.texts("assistant")[0]).toBe(SOLUTION);
    expect(rig.notes).toContain(
      "The mentor wrote 12 lines of solution code. Left in place (leakAction is warn).",
    );
    expect(rig.records()).toContainEqual(expect.objectContaining({ kind: "leak", lines: 12 }));
  });
});
