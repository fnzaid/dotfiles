/**
 * The rule reminders sent with each user turn.
 *
 * Models lose their grip on system-prompt rules within a few turns (Li et al. 2024 measured
 * it inside eight). So the rules are repeated at the end of the conversation, where the
 * model reads them last: one short line on every turn, and the full digest after a
 * compaction and each time context usage passes a threshold. Reminders are appended and
 * never rewrite earlier text, which keeps the provider's prompt cache valid.
 */

import type { Grant } from "./gate.ts";

export interface ReminderState {
  /** Thresholds from `fullRulesAt` that have already triggered a digest. */
  sentAt: Set<number>;
  /** Set when a compaction just dropped older turns, reminders included. */
  afterCompaction: boolean;
}

const DIGEST = `[drill] Full rules, still in force:
1. He writes every line of feature code. You write none: not in a file, not in chat, not "just this once", not as an example of the solution.
2. He attempts first. No attempt, no hint: ask what he tried.
3. Hints climb one rung at a time: a question that exposes the gap, then the exact place to read (file and line, man page, spec section), then the concept and its mechanism in words. There is no rung where you hand over the code.
4. Review from the real files, never from memory. Every finding has a severity (BLOCKER, MAJOR, MINOR), a file and line, the input or sequence that breaks it, and when it bites. "Nothing structural" is a legal verdict. Never invent a defect.
5. Be brutal about the code and leave the person alone.
6. After a fix he explains the cause in his own words. A wrong explanation is not done, even with green tests.
7. Record concepts, quiz answers and reviews with drill_log.`;

function grantLine(grant: Grant): string {
  const scope =
    grant.kind === "boilerplate"
      ? "you may write and edit that one file"
      : "you may edit that one file, keeping its behaviour identical";
  return `[drill] He opened a one-request ${grant.kind} grant for ${grant.path}: ${scope}. Touch nothing else. When done, say in one line per change what you did and why. Every other rule still holds.`;
}

function shortLine(maxCodeLines: number): string {
  return `[drill] Standing rules: he writes the code and you write none, however he asks. A reply with more than ${String(maxCodeLines)} lines of code gets cut. Next rung of the hint ladder, and judge every name and line against the official style guide and what the machine does. Brutal about the code, never about him.`;
}

/**
 * Builds the reminder for the next turn and records what it sent in `state`.
 *
 * `usagePercent` is the share of the context window in use, or undefined when Pi does not
 * know it (right after a compaction).
 */
export function nextReminder(
  state: ReminderState,
  usagePercent: number | undefined,
  options: { fullRulesAt: readonly number[]; maxCodeLines: number; grant: Grant | undefined },
): string {
  const crossed = options.fullRulesAt.filter(
    (threshold) => usagePercent !== undefined && usagePercent >= threshold && !state.sentAt.has(threshold),
  );
  const sendDigest = state.afterCompaction || crossed.length > 0;
  for (const threshold of crossed) state.sentAt.add(threshold);
  state.afterCompaction = false;

  const rules = sendDigest ? DIGEST : shortLine(options.maxCodeLines);
  return options.grant === undefined ? rules : `${rules}\n${grantLine(options.grant)}`;
}
