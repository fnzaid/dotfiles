import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendRecord, logFile, readLog } from "../src/log.ts";

let agentDir: string;
const at = new Date("2026-10-13T09:00:00.000Z");

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "drill-log-"));
});

afterEach(() => {
  rmSync(agentDir, { recursive: true });
});

describe("the learning log", () => {
  it("lives under the agent directory", () => {
    expect(logFile("/home/me/.pi/agent")).toBe("/home/me/.pi/agent/drill/log.jsonl");
  });

  it("reads a missing file as an empty log", () => {
    expect(readLog(logFile(agentDir))).toEqual({ records: [], badLines: 0 });
  });

  it("creates the folder on first write and stamps each record with the time", () => {
    const file = logFile(agentDir);
    appendRecord(file, { kind: "session" }, at);
    appendRecord(
      file,
      { kind: "concept", concept: "idempotency keys", note: "why retries need them", hintLevel: 2 },
      at,
    );
    appendRecord(file, { kind: "quiz", concept: "idempotency keys", correct: true }, at);
    appendRecord(file, { kind: "review", target: "src/retry.ts", blockers: 1, majors: 1, minors: 0 }, at);
    appendRecord(file, { kind: "leak", lines: 12 }, at);
    appendRecord(file, { kind: "grant", grant: "boilerplate", path: "/p/src/types/a.ts" }, at);
    appendRecord(file, { kind: "bypass" }, at);

    const { records, badLines } = readLog(file);
    expect(badLines).toBe(0);
    expect(records.map((record) => record.kind)).toEqual([
      "session",
      "concept",
      "quiz",
      "review",
      "leak",
      "grant",
      "bypass",
    ]);
    expect(records[1]).toEqual({
      ts: "2026-10-13T09:00:00.000Z",
      kind: "concept",
      concept: "idempotency keys",
      note: "why retries need them",
      hintLevel: 2,
    });
  });

  it("counts lines it cannot use and keeps the good ones", () => {
    const file = logFile(agentDir);
    appendRecord(file, { kind: "session" }, at);
    appendFileSync(file, "not json\n");
    appendFileSync(file, `${JSON.stringify({ ts: at.toISOString(), kind: "concept", concept: "x" })}\n`);
    appendFileSync(file, `${JSON.stringify({ ts: at.toISOString(), kind: "unknown" })}\n`);
    appendFileSync(file, "\n");
    appendRecord(file, { kind: "leak", lines: 3 }, at);

    const { records, badLines } = readLog(file);
    expect(records.map((record) => record.kind)).toEqual(["session", "leak"]);
    expect(badLines).toBe(3);
  });
});
