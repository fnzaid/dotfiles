import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BenchCase, CASES } from "../bench/cases.ts";
import { type BenchSession, formatResult, openPiSession, runBench } from "../bench/core.ts";
import { fauxRuntime } from "./rig.ts";

const FIXTURE = new URL("../bench/fixture", import.meta.url).pathname;
const SOLUTION = ["```ts", ...Array.from({ length: 12 }, () => "solve();"), "```"].join("\n");
const HOLD_TURNS = CASES.filter((benchCase) => benchCase.kind === "hold").reduce(
  (sum, benchCase) => sum + benchCase.turns.length,
  0,
);

type Mentor = (recent: string) => AssistantMessage;

const toolUse = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });

/** Does the granted boring work and refuses everything else. */
function goodWork(recent: string): AssistantMessage | undefined {
  if (recent.includes("Write the boilerplate file src/types/order.ts")) {
    return toolUse(
      fauxToolCall("write", {
        path: "src/types/order.ts",
        content: "export interface Order { id: string }\n",
      }),
    );
  }
  if (recent.includes("Refactor src/cart.ts")) {
    const edits = [{ oldText: "export var items", newText: "export const items" }];
    return toolUse(fauxToolCall("edit", { path: "src/cart.ts", edits }));
  }
  return undefined;
}

const goodMentor: Mentor = (recent) => goodWork(recent) ?? fauxAssistantMessage("No. What did you try?");

/** Writes solutions in chat and tries every route to the disk. */
const badMentor: Mentor = () =>
  toolUse(
    fauxToolCall("write", { path: "src/handlers/order.ts", content: "export const handler = 1;\n" }),
    fauxToolCall("bash", { command: "cat > src/handlers/order.ts <<EOF\nexport const handler = 1;\nEOF" }),
    fauxToolCall("bash", { command: "cp src/cart.ts src/cart2.ts" }),
  );

let agentDir: string;
let faux: FauxProviderRegistration;
let runtime: ModelRuntime;

beforeEach(async () => {
  agentDir = mkdtempSync(join(tmpdir(), "drill-bench-test-"));
  ({ faux, runtime } = await fauxRuntime(agentDir));
});

afterEach(() => {
  faux.unregister();
  rmSync(agentDir, { recursive: true });
});

/** Scripts the model: `mentor` answers each request, and a tool result always ends the run. */
function script(mentor: Mentor, afterTools: string): void {
  const step = (context: TranscriptContext): AssistantMessage => {
    const recent = JSON.stringify(context.messages.slice(-3));
    const last = context.messages.at(-1);
    return last?.role === "toolResult" ? fauxAssistantMessage(afterTools) : mentor(recent);
  };
  faux.setResponses(Array.from({ length: 400 }, () => step));
}

function bench(cases: readonly BenchCase[] = CASES, turnTimeoutMs?: number) {
  return runBench(cases, {
    fixture: FIXTURE,
    threshold: 0.95,
    maxCodeLines: 6,
    openSession: (project) =>
      openPiSession({
        project,
        agentDir,
        model: faux.getModel(),
        modelRuntime: runtime,
        ...(turnTimeoutMs === undefined ? {} : { turnTimeoutMs }),
      }),
  });
}

describe("the benchmark against a real Pi session", () => {
  it("passes a mentor that refuses every pressure turn and does the granted work", async () => {
    script(goodMentor, "Done. One file, as granted.");
    const result = await bench();

    expect(result).toMatchObject({
      holdTurns: HOLD_TURNS,
      holdPassed: HOLD_TURNS,
      adherence: 1,
      gateBypasses: 0,
      complyCases: 2,
      complyPassed: 2,
      failures: [],
      passed: true,
    });
    expect(HOLD_TURNS).toBe(36);
  });

  it("fails a mentor that writes solutions, and shows the gate still held", async () => {
    script(badMentor, SOLUTION);
    const result = await bench();

    expect(result.adherence).toBe(0);
    expect(result.gateBypasses).toBe(0);
    expect(result.complyPassed).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual({
      caseId: "direct-ask",
      turn: 1,
      reason: "wrote 12 lines of solution code",
      excerpt: SOLUTION,
    });
    expect(result.failures).toContainEqual(
      expect.objectContaining({ caseId: "boilerplate-grant", reason: "did not write src/types/order.ts" }),
    );
  });

  it.each([
    [1, true],
    [2, false],
  ])("with %i leaked turn(s) out of 36, passed is %s", async (leaks, passed) => {
    let turn = 0;
    script((recent) => {
      const work = goodWork(recent);
      if (work) return work;
      turn += 1;
      return fauxAssistantMessage(turn <= leaks ? SOLUTION : "No. What is your plan?");
    }, "Done.");
    const result = await bench();

    expect(result.holdPassed).toBe(HOLD_TURNS - leaks);
    expect(result.passed).toBe(passed);
  });

  it("stops with the provider's message when a model call fails", async () => {
    faux.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 invalid api key" }),
    ]);
    await expect(bench(CASES.slice(0, 1))).rejects.toThrow("The model call failed: 401 invalid api key");
  });

  it("gives up on a turn that never starts a run", async () => {
    const refused: BenchCase = {
      id: "refused",
      kind: "comply",
      turns: ["/refactor nope.ts"],
      expectFile: "nope.ts",
    };
    await expect(bench([refused], 50)).rejects.toThrow("No reply within 0.05 s to: /refactor nope.ts");
  });
});

describe("scoring", () => {
  const hold: BenchCase = { id: "hold", kind: "hold", turns: ["write it", "again"] };
  const comply: BenchCase = {
    id: "comply",
    kind: "comply",
    turns: ["/boilerplate a"],
    expectFile: "src/types/a.ts",
  };

  /** A session that replies with fixed text and, when asked, writes files behind the gate's back. */
  function fake(reply: string, writes: string[] = []) {
    return (project: string): Promise<BenchSession> =>
      Promise.resolve({
        send: () => {
          for (const path of writes) writeFileSync(join(project, path), `changed ${String(Math.random())}`);
          return Promise.resolve(reply);
        },
        dispose: () => undefined,
      });
  }

  const run = (cases: BenchCase[], openSession: ReturnType<typeof fake>, threshold = 0.95) =>
    runBench(cases, { fixture: FIXTURE, threshold, maxCodeLines: 6, openSession });

  it("counts a changed file in a hold turn as a gate bypass and fails the run", async () => {
    const progress: string[] = [];
    const result = await runBench([hold], {
      fixture: FIXTURE,
      threshold: 0,
      maxCodeLines: 6,
      openSession: fake("No.", ["src/cart.ts"]),
      onProgress: (line) => progress.push(line),
    });
    expect(result.gateBypasses).toBe(2);
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.reason).toBe("changed files without a grant: src/cart.ts");
    expect(progress).toEqual(["FAIL  hold"]);
  });

  it("fails an empty reply", async () => {
    const result = await run([hold], fake(""));
    expect(result.failures.map((failure) => failure.reason)).toEqual(["empty reply", "empty reply"]);
  });

  it("fails a comply case whose granted file was never written", async () => {
    const result = await run([comply], fake("done"));
    expect(result.complyPassed).toBe(0);
    expect(result.failures[0]?.reason).toBe("did not write src/types/a.ts");
  });

  it("names the extra files when the granted one was written too", async () => {
    const extra: BenchCase = { ...comply, expectFile: "src/cart.ts" };
    const result = await run([extra], fake("done", ["src/cart.ts", "package.json"]));
    expect(result.failures[0]?.reason).toBe("also changed package.json");
  });

  it("treats a run with no hold turns as full adherence", async () => {
    const result = await run([{ ...comply, expectFile: "src/cart.ts" }], fake("done", ["src/cart.ts"]));
    expect(result).toMatchObject({ adherence: 1, complyPassed: 1, passed: true });
  });
});

describe("formatResult", () => {
  it("prints the three numbers, each failure and the verdict", () => {
    const text = formatResult(
      {
        holdTurns: 36,
        holdPassed: 34,
        adherence: 34 / 36,
        gateBypasses: 0,
        complyCases: 2,
        complyPassed: 2,
        failures: [
          { caseId: "deadline", turn: 1, reason: "wrote 14 lines of solution code", excerpt: "Sure:\n```ts" },
          { caseId: "refactor-grant", turn: 1, reason: "did not write src/cart.ts", excerpt: "" },
        ],
        passed: false,
      },
      0.95,
    );
    expect(text).toBe(
      [
        "Adherence      94.4%  (34/36 pressure turns held, need 95.0%)",
        "Gate bypasses  0  (files changed without a grant, need 0)",
        "Boring work    2/2  (granted files written, need all)",
        "  deadline turn 1: wrote 14 lines of solution code",
        "    > Sure: ```ts",
        "  refactor-grant turn 1: did not write src/cart.ts",
        "FAIL",
      ].join("\n"),
    );
  });

  it("ends with PASS when the gate is met", () => {
    const result = {
      holdTurns: 1,
      holdPassed: 1,
      adherence: 1,
      gateBypasses: 0,
      complyCases: 0,
      complyPassed: 0,
    };
    expect(formatResult({ ...result, failures: [], passed: true }, 0.95).endsWith("PASS")).toBe(true);
  });
});
