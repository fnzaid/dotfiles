import { describe, expect, it } from "vitest";
import type { DrillRecord } from "../src/log.ts";
import { computeProgress, dueConcepts, formatProgress } from "../src/progress.ts";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

const concept = (name: string, days: number, hintLevel = 1): DrillRecord => ({
  ts: daysAgo(days),
  kind: "concept",
  concept: name,
  note: `explain ${name}`,
  hintLevel,
});
const quiz = (name: string, days: number, correct: boolean): DrillRecord => ({
  ts: daysAgo(days),
  kind: "quiz",
  concept: name,
  correct,
});
const session = (days: number): DrillRecord => ({ ts: daysAgo(days), kind: "session" });

describe("dueConcepts", () => {
  it("has nothing due on an empty log", () => {
    expect(dueConcepts([], NOW)).toEqual([]);
  });

  it("makes a new concept due one day after it was learned", () => {
    expect(dueConcepts([concept("mutex", 0.5)], NOW)).toEqual([]);
    expect(dueConcepts([concept("mutex", 1)], NOW)).toEqual([
      { concept: "mutex", note: "explain mutex", daysOverdue: 0 },
    ]);
  });

  it("waits longer after each correct answer in a row: 3, 7, 14, then 30 days", () => {
    const log = [concept("mutex", 40), quiz("mutex", 30, true)];
    expect(dueConcepts([...log, quiz("mutex", 2.9, true)], NOW)).toEqual([]);
    expect(dueConcepts([concept("mutex", 9), quiz("mutex", 3, true)], NOW)).toHaveLength(1);

    const twoRight = [concept("mutex", 40), quiz("mutex", 30, true), quiz("mutex", 6.9, true)];
    expect(dueConcepts(twoRight, NOW)).toEqual([]);
    const manyRight = Array.from({ length: 9 }, (_, i) => quiz("mutex", 200 - i, true));
    expect(dueConcepts([concept("mutex", 300), ...manyRight, quiz("mutex", 29, true)], NOW)).toEqual([]);
    expect(dueConcepts([concept("mutex", 300), ...manyRight, quiz("mutex", 30, true)], NOW)).toHaveLength(1);
  });

  it("sends a concept back to a one-day wait after a wrong answer", () => {
    const log = [
      concept("mutex", 40),
      quiz("mutex", 30, true),
      quiz("mutex", 20, true),
      quiz("mutex", 1, false),
    ];
    expect(dueConcepts(log, NOW)).toHaveLength(1);
  });

  it("lists the most overdue concept first and matches names without regard to case", () => {
    const log = [concept("Mutex", 5), concept("epoll", 10), quiz("mutex", 4.5, false)];
    expect(dueConcepts(log, NOW).map((due) => due.concept)).toEqual(["epoll", "Mutex"]);
  });

  it("ignores a quiz for a concept that was never logged", () => {
    expect(dueConcepts([quiz("ghost", 9, false)], NOW)).toEqual([]);
  });
});

describe("computeProgress", () => {
  it("reports zeros for an empty log", () => {
    const progress = computeProgress({ records: [], badLines: 0 }, NOW);
    expect(progress.daysUsed).toBe(0);
    expect(progress.streak).toBe(0);
    expect(progress.thisWeek.hintDepth).toBeUndefined();
  });

  it("counts distinct days and the streak ending today", () => {
    const records = [session(0), session(0.1), session(1), session(2), session(5)];
    const progress = computeProgress({ records, badLines: 0 }, NOW);
    expect(progress.daysUsed).toBe(4);
    expect(progress.streak).toBe(3);
  });

  it("keeps a streak alive until the end of the day after the last session", () => {
    const progress = computeProgress({ records: [session(1), session(2)], badLines: 0 }, NOW);
    expect(progress.streak).toBe(2);
    expect(computeProgress({ records: [session(2), session(3)], badLines: 0 }, NOW).streak).toBe(0);
  });

  it("splits the numbers into this week and last week", () => {
    const records: DrillRecord[] = [
      concept("a", 1, 0),
      concept("b", 2, 2),
      concept("c", 9, 3),
      quiz("a", 0.5, true),
      quiz("b", 0.5, false),
      quiz("c", 8, false),
      { ts: daysAgo(1), kind: "review", target: "x.ts", blockers: 1, majors: 2, minors: 0 },
      { ts: daysAgo(3), kind: "review", target: "y.ts", blockers: 0, majors: 0, minors: 1 },
      { ts: daysAgo(10), kind: "review", target: "z.ts", blockers: 3, majors: 0, minors: 0 },
      { ts: daysAgo(2), kind: "leak", lines: 9 },
      { ts: daysAgo(2), kind: "grant", grant: "refactor", path: "/p/a.ts" },
      { ts: daysAgo(8), kind: "bypass" },
      { ts: daysAgo(20), kind: "leak", lines: 4 },
    ];
    const progress = computeProgress({ records, badLines: 2 }, NOW);
    expect(progress.thisWeek).toEqual({
      concepts: 2,
      hintDepth: 1,
      quizAsked: 2,
      quizCorrect: 1,
      reviews: 2,
      blockers: 1,
      leaks: 1,
      grants: 1,
      bypasses: 0,
    });
    expect(progress.lastWeek).toMatchObject({
      concepts: 1,
      hintDepth: 3,
      quizAsked: 1,
      quizCorrect: 0,
      blockers: 3,
      bypasses: 1,
    });
    expect(progress.totalConcepts).toBe(3);
    expect(progress.badLines).toBe(2);
  });
});

describe("formatProgress", () => {
  it("prints this week beside last week", () => {
    const records: DrillRecord[] = [
      session(0),
      session(1),
      concept("a", 1, 1),
      concept("b", 2, 2),
      concept("c", 9, 3),
      quiz("a", 0.5, true),
      quiz("b", 0.5, false),
      quiz("c", 0.2, true),
      { ts: daysAgo(1), kind: "review", target: "x.ts", blockers: 1, majors: 0, minors: 0 },
      { ts: daysAgo(10), kind: "review", target: "z.ts", blockers: 3, majors: 0, minors: 0 },
    ];
    expect(formatProgress(computeProgress({ records, badLines: 0 }, NOW))).toBe(
      [
        "Days used: 2 (streak 2)",
        "Concepts logged: 3, due for a quiz now: 0",
        "",
        "                  this week   last week",
        "Concepts          2           1",
        "Hint depth        1.5         3.0         lower is better, 0 is unaided",
        "Quiz accuracy     2/3 (67%)   -",
        "Blockers/review   1.0         3.0",
        "Code leaks        0           0           mentor wrote a solution in chat",
        "Grants            0           0           files you let the mentor write",
        "Bypassed runs     0           0           started with --drill-off",
      ].join("\n"),
    );
  });

  it("shows dashes where there is nothing to measure and mentions unreadable lines", () => {
    const text = formatProgress(computeProgress({ records: [], badLines: 4 }, NOW));
    expect(text).toContain("Hint depth        -           -");
    expect(text).toContain("Blockers/review   -           -");
    expect(text).toContain("4 unreadable lines in the log were skipped.");
  });
});
