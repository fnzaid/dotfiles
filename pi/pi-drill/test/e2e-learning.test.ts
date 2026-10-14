import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createRig, type Rig } from "./rig.ts";

const DAY = 86_400_000;
const START = new Date("2026-10-13T09:00:00.000Z");

const toolUse = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });

let rig: Rig;
let clock: Date;
const now = (): Date => clock;

afterEach(() => {
  rig.dispose();
});

async function learn(concept: string, note: string, hintLevel: number): Promise<void> {
  rig.faux.setResponses([
    toolUse(fauxToolCall("drill_log", { kind: "concept", concept, note, hintLevel })),
    fauxAssistantMessage("Logged. Next."),
  ]);
  await rig.session.prompt(`I get ${concept} now`);
}

describe("the learning log", () => {
  it("records a session, concepts, quiz answers and reviews through drill_log", async () => {
    clock = START;
    rig = await createRig({ now });
    rig.faux.setResponses([
      toolUse(
        fauxToolCall("drill_log", {
          kind: "concept",
          concept: "idempotency keys",
          note: "why a retry needs one",
          hintLevel: 2,
        }),
        fauxToolCall("drill_log", { kind: "quiz", concept: "idempotency keys", correct: true }),
        fauxToolCall("drill_log", { kind: "review", target: "src/retry.ts", blockers: 1, majors: 1 }),
      ),
      fauxAssistantMessage("Logged."),
    ]);
    await rig.session.prompt("done with the retry");

    expect(rig.records()).toEqual([
      { ts: "2026-10-13T09:00:00.000Z", kind: "session" },
      {
        ts: "2026-10-13T09:00:00.000Z",
        kind: "concept",
        concept: "idempotency keys",
        note: "why a retry needs one",
        hintLevel: 2,
      },
      { ts: "2026-10-13T09:00:00.000Z", kind: "quiz", concept: "idempotency keys", correct: true },
      {
        ts: "2026-10-13T09:00:00.000Z",
        kind: "review",
        target: "src/retry.ts",
        blockers: 1,
        majors: 1,
        minors: 0,
      },
    ]);
    expect(rig.texts("toolResult")).toEqual(["Logged concept.", "Logged quiz.", "Logged review."]);
  });

  it("tells the model which field is missing and logs nothing", async () => {
    clock = START;
    rig = await createRig({ now });
    rig.faux.setResponses([
      toolUse(fauxToolCall("drill_log", { kind: "concept", concept: "epoll" })),
      fauxAssistantMessage("ok"),
    ]);
    await rig.session.prompt("log it");

    expect(rig.texts("toolResult")[0]).toContain('a concept record needs "note"');
    expect(rig.records().map((record) => record.kind)).toEqual(["session"]);
  });
});

describe("/quiz", () => {
  it("says so when nothing is due", async () => {
    clock = START;
    rig = await createRig({ now });
    await learn("epoll", "level versus edge triggered", 1);
    await rig.session.prompt("/quiz");

    expect(rig.notes.at(-1)).toContain("Nothing is due for a quiz");
    expect(rig.texts("custom").some((text) => text.includes("He ran /quiz"))).toBe(false);
  });

  it("hands the due concepts to the mentor without showing him the answers", async () => {
    clock = START;
    rig = await createRig({ now });
    await learn("epoll", "level versus edge triggered", 1);
    await learn("mutex", "why a lock must not be copied", 3);
    await learn("WAL", "why the log is written before the page", 0);
    await learn("vector clocks", "how they order concurrent writes", 2);

    clock = new Date(START.getTime() + 2 * DAY);
    rig.faux.setResponses([
      fauxAssistantMessage("Question one: what does edge triggered mean for a half-read socket?"),
    ]);
    await rig.run("/quiz");

    const quiz = rig.session.messages.find(
      (message) => message.role === "custom" && message.customType === "drill-quiz",
    );
    expect(quiz).toMatchObject({ display: false });
    const text = rig.texts("custom").find((entry) => entry.includes("He ran /quiz")) ?? "";
    expect(text).toContain("1. epoll: level versus edge triggered");
    expect(text).toContain("3. WAL: why the log is written before the page");
    expect(text).not.toContain("vector clocks");
    expect(rig.notes.at(-1)).toBe("Quiz: 3 concepts. Answer from memory.");
    expect(rig.texts("user").some((entry) => entry.includes("level versus edge triggered"))).toBe(false);
  });

  it("reminds him at start-up when concepts are due", async () => {
    clock = START;
    rig = await createRig({ now });
    await learn("epoll", "level versus edge triggered", 1);
    expect(rig.notes).toEqual([]);

    clock = new Date(START.getTime() + 3 * DAY);
    await rig.session.reload();
    expect(rig.notes).toContain("1 concepts are due. Run /quiz before you start.");
  });
});

describe("/progress", () => {
  it("prints the report from the log", async () => {
    clock = START;
    rig = await createRig({ now });
    await learn("epoll", "level versus edge triggered", 2);
    await rig.session.prompt("/progress");

    const report = rig.notes.at(-1) ?? "";
    expect(report).toContain("Days used: 1 (streak 1)");
    expect(report).toContain("Concepts          1           0");
    expect(report).toContain("Hint depth        2.0         -");
  });
});

describe("settings problems", () => {
  it("shows every problem at start-up and keeps the strict defaults", async () => {
    rig = await createRig({ config: { maxCodeLines: 9000, leakAction: "warn" } });
    expect(rig.notes).toEqual([expect.stringContaining("drill settings ignored:")]);
    expect(rig.notes[0]).toContain("/maxCodeLines must be <= 200");

    const solution = ["```ts", ...Array.from({ length: 8 }, () => "work();"), "```"].join("\n");
    rig.faux.setResponses([fauxAssistantMessage(solution)]);
    await rig.session.prompt("write it");
    expect(rig.texts("assistant")[0]).toContain("[drill removed 8 lines of code");
  });

  it("applies the user's extra shell commands", async () => {
    rig = await createRig({ config: { bashAllow: ["^ls-custom$", "^true$"] } });
    rig.faux.setResponses([toolUse(fauxToolCall("bash", { command: "true" })), fauxAssistantMessage("ok")]);
    await rig.session.prompt("run it");
    expect(rig.texts("toolResult")[0]).not.toContain("Blocked by drill");
  });
});

describe("--drill-off", () => {
  it("stands down completely and records the bypass", async () => {
    clock = START;
    rig = await createRig({ off: true, now, files: { "src/cart.ts": "export const total = 0;\n" } });
    let request = "";
    const solution = ["```ts", ...Array.from({ length: 8 }, () => "work();"), "```"].join("\n");
    rig.faux.setResponses([
      toolUse(
        fauxToolCall("write", { path: "src/new.ts", content: "export const made = true;\n" }),
        fauxToolCall("bash", { command: "cp src/cart.ts src/copy.ts" }),
      ),
      (context) => {
        request = JSON.stringify(context);
        return fauxAssistantMessage(solution);
      },
    ]);
    await rig.session.prompt("prod is down, write the fix");

    expect(readFileSync(join(rig.project, "src/new.ts"), "utf8")).toBe("export const made = true;\n");
    expect(existsSync(join(rig.project, "src/copy.ts"))).toBe(true);
    expect(request).toContain("You are an expert coding assistant");
    expect(request).not.toContain("[drill]");
    expect(rig.texts("assistant").at(-1)).toBe(solution);
    expect(rig.session.getActiveToolNames()).toEqual(expect.arrayContaining(["write", "edit"]));
    expect(rig.notes[0]).toContain("drill is OFF for this run");
    expect(rig.records()).toEqual([{ ts: "2026-10-13T09:00:00.000Z", kind: "bypass" }]);
  });

  it("refuses the grant commands, which would be pointless", async () => {
    rig = await createRig({ off: true });
    await rig.session.prompt("/boilerplate src/types/a.ts");
    expect(rig.notes.at(-1)).toContain("drill is off for this run");
    await rig.session.prompt("/refactor src/types/a.ts");
    expect(rig.notes.at(-1)).toContain("drill is off for this run");
  });
});

describe("a grant requested while the mentor is still working", () => {
  it("is refused until the run finishes", async () => {
    rig = await createRig();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    rig.faux.setResponses([
      async () => {
        await held;
        return fauxAssistantMessage("done thinking");
      },
    ]);
    const running = rig.session.prompt("review my cart");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rig.session.prompt("/boilerplate src/types/order.ts", { streamingBehavior: "followUp" });
    release();
    await running;

    expect(rig.notes).toContain("Wait for the mentor to finish, then run this again.");
    expect(rig.records().some((record) => record.kind === "grant")).toBe(false);
  });
});
