/**
 * The learning log: one JSON record per line in `<agent dir>/drill/log.jsonl`.
 *
 * It lives outside any one project because the skill being tracked is his, not a repo's.
 * The file is append-only. Progress numbers are always computed from it, never stored.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const Timestamp = Type.String({ minLength: 20 });

const RecordSchema = Type.Union([
  /** Pi started with drill on. Counts the days he used it. */
  Type.Object({ ts: Timestamp, kind: Type.Literal("session") }),
  /** Pi started with `--drill-off`. Counted so the progress report cannot hide it. */
  Type.Object({ ts: Timestamp, kind: Type.Literal("bypass") }),
  /** Something he worked out, and how far up the hint ladder he had to go (0 is unaided). */
  Type.Object({
    ts: Timestamp,
    kind: Type.Literal("concept"),
    concept: Type.String({ minLength: 1 }),
    note: Type.String({ minLength: 1 }),
    hintLevel: Type.Integer({ minimum: 0, maximum: 3 }),
  }),
  /** One retrieval question about an earlier concept. */
  Type.Object({
    ts: Timestamp,
    kind: Type.Literal("quiz"),
    concept: Type.String({ minLength: 1 }),
    correct: Type.Boolean(),
  }),
  /** One code review and the defects it found, by severity. */
  Type.Object({
    ts: Timestamp,
    kind: Type.Literal("review"),
    target: Type.String({ minLength: 1 }),
    blockers: Type.Integer({ minimum: 0 }),
    majors: Type.Integer({ minimum: 0 }),
    minors: Type.Integer({ minimum: 0 }),
  }),
  /** The mentor put a solution in chat. `lines` is how much code that was. */
  Type.Object({ ts: Timestamp, kind: Type.Literal("leak"), lines: Type.Integer({ minimum: 1 }) }),
  /** He let the mentor write or edit one file. */
  Type.Object({
    ts: Timestamp,
    kind: Type.Literal("grant"),
    grant: Type.Union([Type.Literal("boilerplate"), Type.Literal("refactor")]),
    path: Type.String({ minLength: 1 }),
  }),
]);

export type DrillRecord = Static<typeof RecordSchema>;

/** A record before the log stamps it with the time. */
export type DrillEvent = DrillRecord extends infer R ? (R extends unknown ? Omit<R, "ts"> : never) : never;

export interface LogContents {
  records: DrillRecord[];
  /** Lines that were not valid records. Reported, never silently dropped. */
  badLines: number;
}

/** Where the log lives for a given Pi agent directory. */
export function logFile(agentDir: string): string {
  return join(agentDir, "drill", "log.jsonl");
}

/** Appends one record, creating the folder on first use. */
export function appendRecord(file: string, event: DrillEvent, now: Date): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ ts: now.toISOString(), ...event })}\n`, "utf8");
}

function parseLine(line: string): DrillRecord | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return Value.Check(RecordSchema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Reads every record. A missing file is an empty log, not an error. */
export function readLog(file: string): LogContents {
  if (!existsSync(file)) return { records: [], badLines: 0 };

  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const records = lines.map(parseLine).filter((record) => record !== undefined);
  return { records, badLines: lines.length - records.length };
}
