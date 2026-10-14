import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
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

describe("/boilerplate", () => {
  it("lets the mentor write the one granted file, nothing else, and only for that request", async () => {
    rig = await createRig({ files: { "src/cart.ts": "export const total = 0;\n" } });
    let toolsDuringGrant: string[] = [];
    rig.faux.setResponses([
      toolUse(
        fauxToolCall("write", {
          path: "src/types/order.ts",
          content: "export interface Order { id: string }\n",
        }),
        fauxToolCall("write", { path: "src/cart.ts", content: "hijacked\n" }),
        fauxToolCall("bash", { command: "cp src/types/order.ts src/handler.ts" }),
      ),
      () => {
        toolsDuringGrant = rig.session.getActiveToolNames();
        return fauxAssistantMessage(`Wrote it:\n${SOLUTION}`);
      },
    ]);
    await rig.run("/boilerplate src/types/order.ts the Order type from the schema");

    expect(fileText("src/types/order.ts")).toBe("export interface Order { id: string }\n");
    expect(fileText("src/cart.ts")).toBe("export const total = 0;\n");
    expect(exists("src/handler.ts")).toBe(false);
    expect(toolsDuringGrant).toEqual(expect.arrayContaining(["write", "edit"]));
    expect(rig.texts("user")).toEqual([
      "Write the boilerplate file src/types/order.ts. the Order type from the schema",
    ]);
    expect(rig.texts("custom")[0]).toContain("one-request boilerplate grant");
    // During a grant the mentor may show the file it wrote.
    expect(rig.texts("assistant").at(-1)).toContain("const step0 = 0;");
    expect(rig.records()).toContainEqual(
      expect.objectContaining({
        kind: "grant",
        grant: "boilerplate",
        path: join(rig.project, "src/types/order.ts"),
      }),
    );

    expect(rig.session.getActiveToolNames()).toEqual(MENTOR_TOOLS);
    rig.faux.setResponses([
      toolUse(fauxToolCall("write", { path: "src/types/order.ts", content: "second write\n" })),
      fauxAssistantMessage("no"),
    ]);
    await rig.session.prompt("and add the handler while you are there");
    expect(fileText("src/types/order.ts")).toBe("export interface Order { id: string }\n");
  });

  it("uses a default instruction when he gives only the path", async () => {
    rig = await createRig();
    rig.faux.setResponses([fauxAssistantMessage("done")]);
    await rig.run("/boilerplate src/logger.ts");
    expect(rig.texts("user")).toEqual([
      "Write the boilerplate file src/logger.ts. Work out the contents from what we discussed.",
    ]);
  });

  it.each([
    ["src/cart.ts", "not a boilerplate path"],
    ["../elsewhere/types/a.ts", "outside this project"],
    ["", "Usage: /boilerplate <path> [what it should contain]"],
  ])("refuses %j without starting a run", async (path, reason) => {
    rig = await createRig();
    await rig.session.prompt(`/boilerplate ${path}`);

    expect(rig.notes.at(-1)).toContain(reason);
    expect(rig.session.messages.filter((message) => message.role === "user")).toHaveLength(0);
    expect(rig.records().some((record) => record.kind === "grant")).toBe(false);
    expect(rig.session.getActiveToolNames()).not.toContain("write");
  });

  it("honours extra boilerplate globs from the project settings", async () => {
    rig = await createRig({ config: { boilerplate: ["proto/**"] } });
    rig.faux.setResponses([fauxAssistantMessage("done")]);
    await rig.run("/boilerplate proto/order.proto");
    expect(rig.records().some((record) => record.kind === "grant")).toBe(true);

    await rig.session.prompt("/boilerplate src/types/order.ts");
    expect(rig.notes.at(-1)).toContain("not a boilerplate path");
  });
});

describe("/refactor", () => {
  it("lets the mentor edit the one file and refuses a full rewrite", async () => {
    rig = await createRig({
      files: { "src/cart.ts": "export const total = 0;\n", "src/other.ts": "export const x = 1;\n" },
    });
    rig.faux.setResponses([
      toolUse(
        fauxToolCall("edit", {
          path: "src/cart.ts",
          edits: [{ oldText: "total = 0", newText: "TOTAL = 0" }],
        }),
        fauxToolCall("write", { path: "src/cart.ts", content: "rewritten\n" }),
        fauxToolCall("edit", { path: "src/other.ts", edits: [{ oldText: "x = 1", newText: "x = 2" }] }),
      ),
      fauxAssistantMessage(
        "Renamed the constant: constants are upper case, which stops them reading as mutable state.",
      ),
    ]);
    await rig.run("/refactor src/cart.ts naming");

    expect(fileText("src/cart.ts")).toBe("export const TOTAL = 0;\n");
    expect(fileText("src/other.ts")).toBe("export const x = 1;\n");
    expect(rig.texts("user")[0]).toContain(
      "Refactor src/cart.ts to best practice without changing what it does. Focus on: naming.",
    );
    expect(rig.texts("custom")[0]).toContain("one-request refactor grant");
    expect(rig.session.getActiveToolNames()).toEqual(MENTOR_TOOLS);
  });

  it("asks for the reasons behind each change when he names no focus", async () => {
    rig = await createRig({ files: { "src/cart.ts": "export const total = 0;\n" } });
    rig.faux.setResponses([fauxAssistantMessage("nothing to change")]);
    await rig.run("/refactor src/cart.ts");
    expect(rig.texts("user")[0]).toBe(
      "Refactor src/cart.ts to best practice without changing what it does. Then list each change in one line: what you changed, the practice behind it, and what it prevents.",
    );
  });

  it.each([
    ["src/missing.ts", "is not a file with code in it"],
    ["src/empty.ts", "is not a file with code in it"],
    ["src", "is not a file with code in it"],
    ["/etc/hosts", "outside this project"],
    ["", "Usage: /refactor <path> [what to focus on]"],
  ])("refuses %j without starting a run", async (path, reason) => {
    rig = await createRig({ files: { "src/empty.ts": "" } });
    await rig.session.prompt(`/refactor ${path}`);

    expect(rig.notes.at(-1)).toContain(reason);
    expect(rig.records().some((record) => record.kind === "grant")).toBe(false);
  });
});
