/**
 * Turns the learning log into two things: the concepts due for a quiz, and a progress report.
 *
 * Quizzes follow a Leitner schedule, because spaced retrieval practice is one of the two
 * study techniques with strong evidence behind it (Dunlosky et al. 2013). The report
 * compares this week with last week, so "am I improving" has a measured answer.
 */

import type { DrillRecord, LogContents } from "./log.ts";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Days to wait before the next quiz, indexed by correct answers in a row. */
const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
const LONGEST_INTERVAL = 30;

export interface DueConcept {
  concept: string;
  /** What he should be able to explain, as recorded when the concept was logged. */
  note: string;
  daysOverdue: number;
}

export interface WeekStats {
  concepts: number;
  /** Mean hint depth, or undefined when no concept was logged. */
  hintDepth: number | undefined;
  quizAsked: number;
  quizCorrect: number;
  reviews: number;
  blockers: number;
  leaks: number;
  grants: number;
  bypasses: number;
}

export interface Progress {
  daysUsed: number;
  /** Days in a row with a session, ending today or yesterday. */
  streak: number;
  totalConcepts: number;
  dueNow: number;
  thisWeek: WeekStats;
  lastWeek: WeekStats;
  badLines: number;
}

interface ConceptHistory {
  concept: string;
  note: string;
  lastSeen: number;
  correctInARow: number;
}

function conceptHistories(records: readonly DrillRecord[]): ConceptHistory[] {
  const byName = new Map<string, ConceptHistory>();
  for (const record of records) {
    if (record.kind !== "concept" && record.kind !== "quiz") continue;
    const key = record.concept.trim().toLowerCase();
    const seen = Date.parse(record.ts);
    const history = byName.get(key) ?? {
      concept: record.concept,
      note: "",
      lastSeen: seen,
      correctInARow: 0,
    };
    history.lastSeen = Math.max(history.lastSeen, seen);
    if (record.kind === "concept") history.note = record.note;
    else history.correctInARow = record.correct ? history.correctInARow + 1 : 0;
    byName.set(key, history);
  }
  // A quiz for a concept that was never logged has nothing to ask about.
  return [...byName.values()].filter((history) => history.note !== "");
}

/** Lists the concepts whose next quiz date has passed, most overdue first. */
export function dueConcepts(records: readonly DrillRecord[], now: Date): DueConcept[] {
  return conceptHistories(records)
    .map((history) => {
      const waitDays = INTERVAL_DAYS[history.correctInARow] ?? LONGEST_INTERVAL;
      const daysOverdue = (now.getTime() - history.lastSeen) / DAY_MS - waitDays;
      return { concept: history.concept, note: history.note, daysOverdue };
    })
    .filter((due) => due.daysOverdue >= 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

function count(records: readonly DrillRecord[], kind: DrillRecord["kind"]): number {
  return records.filter((record) => record.kind === kind).length;
}

function weekStats(records: readonly DrillRecord[], from: number, to: number): WeekStats {
  const week = records.filter((record) => {
    const at = Date.parse(record.ts);
    return at >= from && at < to;
  });
  const concepts = week.filter((record) => record.kind === "concept");
  const quizzes = week.filter((record) => record.kind === "quiz");
  const reviews = week.filter((record) => record.kind === "review");
  const depthSum = concepts.reduce((sum, record) => sum + record.hintLevel, 0);
  return {
    concepts: concepts.length,
    hintDepth: concepts.length > 0 ? depthSum / concepts.length : undefined,
    quizAsked: quizzes.length,
    quizCorrect: quizzes.filter((record) => record.correct).length,
    reviews: reviews.length,
    blockers: reviews.reduce((sum, record) => sum + record.blockers, 0),
    leaks: count(week, "leak"),
    grants: count(week, "grant"),
    bypasses: count(week, "bypass"),
  };
}

function streakEnding(days: ReadonlySet<string>, now: Date): number {
  const dayOf = (time: number): string => new Date(time).toISOString().slice(0, 10);
  let cursor = days.has(dayOf(now.getTime())) ? now.getTime() : now.getTime() - DAY_MS;
  let streak = 0;
  while (days.has(dayOf(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

/** Computes the report numbers as of `now`. Weeks are rolling seven-day windows. */
export function computeProgress(log: LogContents, now: Date): Progress {
  const { records } = log;
  const sessionDays = new Set(
    records.filter((record) => record.kind === "session").map((record) => record.ts.slice(0, 10)),
  );
  const end = now.getTime() + 1;
  return {
    daysUsed: sessionDays.size,
    streak: streakEnding(sessionDays, now),
    totalConcepts: conceptHistories(records).length,
    dueNow: dueConcepts(records, now).length,
    thisWeek: weekStats(records, end - WEEK_MS, end),
    lastWeek: weekStats(records, end - 2 * WEEK_MS, end - WEEK_MS),
    badLines: log.badLines,
  };
}

function ratio(part: number, whole: number, digits: number): string {
  return whole === 0 ? "-" : (part / whole).toFixed(digits);
}

function row(label: string, thisWeek: string, lastWeek: string, note = ""): string {
  return `${label.padEnd(18)}${thisWeek.padEnd(12)}${lastWeek.padEnd(12)}${note}`.trimEnd();
}

function quizCell(week: WeekStats): string {
  if (week.quizAsked === 0) return "-";
  const percent = Math.round((100 * week.quizCorrect) / week.quizAsked);
  return `${String(week.quizCorrect)}/${String(week.quizAsked)} (${String(percent)}%)`;
}

/** Renders the report as plain text for the terminal. */
export function formatProgress(progress: Progress): string {
  const { thisWeek, lastWeek } = progress;
  const depth = (week: WeekStats): string => week.hintDepth?.toFixed(1) ?? "-";
  const lines = [
    `Days used: ${String(progress.daysUsed)} (streak ${String(progress.streak)})`,
    `Concepts logged: ${String(progress.totalConcepts)}, due for a quiz now: ${String(progress.dueNow)}`,
    "",
    row("", "this week", "last week"),
    row("Concepts", String(thisWeek.concepts), String(lastWeek.concepts)),
    row("Hint depth", depth(thisWeek), depth(lastWeek), "lower is better, 0 is unaided"),
    row("Quiz accuracy", quizCell(thisWeek), quizCell(lastWeek)),
    row(
      "Blockers/review",
      ratio(thisWeek.blockers, thisWeek.reviews, 1),
      ratio(lastWeek.blockers, lastWeek.reviews, 1),
    ),
    row("Code leaks", String(thisWeek.leaks), String(lastWeek.leaks), "mentor wrote a solution in chat"),
    row("Grants", String(thisWeek.grants), String(lastWeek.grants), "files you let the mentor write"),
    row("Bypassed runs", String(thisWeek.bypasses), String(lastWeek.bypasses), "started with --drill-off"),
  ];
  if (progress.badLines > 0) {
    lines.push("", `${String(progress.badLines)} unreadable lines in the log were skipped.`);
  }
  return lines.join("\n");
}
