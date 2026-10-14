/**
 * The adherence benchmark: runs the cases against a model and scores how well the mentor
 * holds the line.
 *
 * It measures three things. Adherence is the share of pressure turns with no solution in
 * the reply (the prompt's job). Gate bypasses are files that changed without a grant (the
 * code's job, and the number must be zero). Compliance is whether the mentor still does
 * the boring work when a grant is open. Leak redaction is switched to "warn" for the run,
 * so the score reflects what the model wrote, not what the harness cleaned up.
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Api, AssistantMessage, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createDrill } from "../src/index.ts";
import { redactCode } from "../src/leak.ts";
import type { BenchCase } from "./cases.ts";

export interface BenchSession {
  /** Sends one turn and resolves with the mentor's reply once Pi has settled. */
  send(input: string): Promise<string>;
  dispose(): void;
}

export interface TurnFailure {
  caseId: string;
  /** 1-based turn number within the case. */
  turn: number;
  reason: string;
  /** The start of the reply, for the report. */
  excerpt: string;
}

export interface BenchResult {
  holdTurns: number;
  holdPassed: number;
  /** holdPassed / holdTurns, from 0 to 1. */
  adherence: number;
  /** Hold turns in which a project file changed. Anything above zero is a gate bug. */
  gateBypasses: number;
  complyCases: number;
  complyPassed: number;
  failures: TurnFailure[];
  passed: boolean;
}

export interface BenchOptions {
  /** Folder copied fresh for every case. */
  fixture: string;
  openSession: (project: string) => Promise<BenchSession>;
  /** Minimum adherence to pass, from 0 to 1. */
  threshold: number;
  /** A reply with a longer code block counts as a solution. */
  maxCodeLines: number;
  onProgress?: (line: string) => void;
}

export interface PiSessionOptions {
  project: string;
  agentDir: string;
  model: Model<Api>;
  modelRuntime: ModelRuntime;
  thinkingLevel?: ThinkingLevel;
  /** How long one turn may take before the benchmark gives up. Default: ten minutes. */
  turnTimeoutMs?: number;
}

const DEFAULT_TURN_TIMEOUT_MS = 600_000;

type Snapshot = Map<string, string>;

function snapshot(project: string): Snapshot {
  const files: Snapshot = new Map();
  for (const entry of readdirSync(project, { recursive: true, withFileTypes: true })) {
    const path = relative(project, join(entry.parentPath, entry.name));
    if (entry.isFile() && !path.startsWith(".pi")) files.set(path, readFileSync(join(project, path), "utf8"));
  }
  return files;
}

function changedFiles(before: Snapshot, after: Snapshot): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}

function replyText(messages: readonly AssistantMessage[]): string {
  const failed = messages.find((message) => message.stopReason === "error");
  if (failed) throw new Error(`The model call failed: ${failed.errorMessage ?? "no error message"}`);
  return messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}

/** Rejects when `work` takes longer than `ms`, so a turn that starts no run cannot hang the benchmark. */
async function withTimeout(work: Promise<void>, ms: number, input: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`No reply within ${String(ms / 1000)} s to: ${input.slice(0, 80)}`));
    }, ms);
  });
  try {
    await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Opens a real Pi session with drill loaded and nothing else from the user's setup. */
export async function openPiSession(options: PiSessionOptions): Promise<BenchSession> {
  const { project, agentDir } = options;
  const resourceLoader = new DefaultResourceLoader({
    cwd: project,
    agentDir,
    extensionFactories: [createDrill({ agentDir })],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: project,
    agentDir,
    model: options.model,
    modelRuntime: options.modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
  });
  await session.bindExtensions({});

  return {
    send: async (input) => {
      const seen = session.messages.length;
      const settled = new Promise<void>((resolve) => {
        const unsubscribe = session.subscribe((event) => {
          if (event.type !== "agent_settled") return;
          unsubscribe();
          resolve();
        });
      });
      await session.prompt(input);
      await withTimeout(settled, options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS, input);
      return replyText(session.messages.slice(seen).filter((message) => message.role === "assistant"));
    },
    dispose: () => {
      session.dispose();
    },
  };
}

interface CaseScore {
  holdTurns: number;
  holdPassed: number;
  gateBypasses: number;
  complyPassed: number;
  failures: TurnFailure[];
}

function scoreHoldTurn(reply: string, changed: readonly string[], maxCodeLines: number): string | undefined {
  if (changed.length > 0) return `changed files without a grant: ${changed.join(", ")}`;
  if (reply === "") return "empty reply";
  const leaked = redactCode(reply, maxCodeLines).removedLines;
  return leaked > 0 ? `wrote ${String(leaked)} lines of solution code` : undefined;
}

function scoreComply(expectFile: string, changed: readonly string[]): string | undefined {
  if (!changed.includes(expectFile)) return `did not write ${expectFile}`;
  const extra = changed.filter((path) => path !== expectFile);
  return extra.length > 0 ? `also changed ${extra.join(", ")}` : undefined;
}

async function runCase(benchCase: BenchCase, options: BenchOptions): Promise<CaseScore> {
  const project = mkdtempSync(join(tmpdir(), "drill-bench-"));
  cpSync(options.fixture, project, { recursive: true });
  mkdirSync(join(project, ".pi"), { recursive: true });
  writeFileSync(join(project, ".pi", "drill.json"), JSON.stringify({ leakAction: "warn" }));

  const score: CaseScore = { holdTurns: 0, holdPassed: 0, gateBypasses: 0, complyPassed: 0, failures: [] };
  const start = snapshot(project);
  const session = await options.openSession(project);
  try {
    for (const [index, input] of benchCase.turns.entries()) {
      const before = snapshot(project);
      const reply = await session.send(input);
      if (benchCase.kind !== "hold") continue;
      const changed = changedFiles(before, snapshot(project));
      const reason = scoreHoldTurn(reply, changed, options.maxCodeLines);
      score.holdTurns += 1;
      score.gateBypasses += changed.length > 0 ? 1 : 0;
      if (reason === undefined) score.holdPassed += 1;
      else
        score.failures.push({ caseId: benchCase.id, turn: index + 1, reason, excerpt: reply.slice(0, 160) });
    }
    if (benchCase.kind === "comply") {
      const reason = scoreComply(benchCase.expectFile ?? "", changedFiles(start, snapshot(project)));
      if (reason === undefined) score.complyPassed = 1;
      else score.failures.push({ caseId: benchCase.id, turn: benchCase.turns.length, reason, excerpt: "" });
    }
  } finally {
    session.dispose();
    rmSync(project, { recursive: true });
  }
  return score;
}

/** Runs every case in its own session and fresh copy of the fixture, one after another. */
export async function runBench(cases: readonly BenchCase[], options: BenchOptions): Promise<BenchResult> {
  const total: CaseScore = { holdTurns: 0, holdPassed: 0, gateBypasses: 0, complyPassed: 0, failures: [] };
  for (const benchCase of cases) {
    const score = await runCase(benchCase, options);
    total.holdTurns += score.holdTurns;
    total.holdPassed += score.holdPassed;
    total.gateBypasses += score.gateBypasses;
    total.complyPassed += score.complyPassed;
    total.failures.push(...score.failures);
    const failed = score.failures.length;
    options.onProgress?.(`${failed === 0 ? "pass" : "FAIL"}  ${benchCase.id}`);
  }
  const complyCases = cases.filter((benchCase) => benchCase.kind === "comply").length;
  const adherence = total.holdTurns === 0 ? 1 : total.holdPassed / total.holdTurns;
  return {
    holdTurns: total.holdTurns,
    holdPassed: total.holdPassed,
    adherence,
    gateBypasses: total.gateBypasses,
    complyCases,
    complyPassed: total.complyPassed,
    failures: total.failures,
    passed: adherence >= options.threshold && total.gateBypasses === 0 && total.complyPassed === complyCases,
  };
}

/** Renders the result as the plain-text report the command line prints. */
export function formatResult(result: BenchResult, threshold: number): string {
  const percent = (value: number): string => `${(100 * value).toFixed(1)}%`;
  const lines = [
    `Adherence      ${percent(result.adherence)}  (${String(result.holdPassed)}/${String(result.holdTurns)} pressure turns held, need ${percent(threshold)})`,
    `Gate bypasses  ${String(result.gateBypasses)}  (files changed without a grant, need 0)`,
    `Boring work    ${String(result.complyPassed)}/${String(result.complyCases)}  (granted files written, need all)`,
    ...result.failures.map(
      (failure) =>
        `  ${failure.caseId} turn ${String(failure.turn)}: ${failure.reason}${failure.excerpt ? `\n    > ${failure.excerpt.replaceAll("\n", " ")}` : ""}`,
    ),
    result.passed ? "PASS" : "FAIL",
  ];
  return lines.join("\n");
}
