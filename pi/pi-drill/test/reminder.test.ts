import { describe, expect, it } from "vitest";
import type { Grant } from "../src/gate.ts";
import { nextReminder, type ReminderState } from "../src/reminder.ts";

const fresh = (): ReminderState => ({ sentAt: new Set(), afterCompaction: false });
const options = (grant?: Grant) => ({ fullRulesAt: [25, 50, 75], maxCodeLines: 6, grant });

describe("nextReminder", () => {
  it("sends the short line on an ordinary turn", () => {
    const text = nextReminder(fresh(), 3, options());
    expect(text).toContain("Standing rules");
    expect(text).toContain("more than 6 lines of code");
    expect(text).not.toContain("Full rules");
  });

  it("sends the short line when Pi does not know the context usage", () => {
    expect(nextReminder(fresh(), undefined, options())).toContain("Standing rules");
  });

  it("sends the full digest once each time usage passes a threshold", () => {
    const state = fresh();
    expect(nextReminder(state, 24, options())).toContain("Standing rules");
    expect(nextReminder(state, 25, options())).toContain("Full rules");
    expect(nextReminder(state, 40, options())).toContain("Standing rules");
    expect(nextReminder(state, 51, options())).toContain("Full rules");
    expect(nextReminder(state, 52, options())).toContain("Standing rules");
  });

  it("sends one digest when usage jumps past several thresholds at once", () => {
    const state = fresh();
    expect(nextReminder(state, 80, options())).toContain("Full rules");
    expect(state.sentAt).toEqual(new Set([25, 50, 75]));
    expect(nextReminder(state, 81, options())).toContain("Standing rules");
  });

  it("sends the digest on the first turn after a compaction, then goes back to the short line", () => {
    const state: ReminderState = { sentAt: new Set(), afterCompaction: true };
    expect(nextReminder(state, undefined, options())).toContain("Full rules");
    expect(state.afterCompaction).toBe(false);
    expect(nextReminder(state, 5, options())).toContain("Standing rules");
  });

  it("names the file and the limits of a boilerplate grant", () => {
    const text = nextReminder(fresh(), 3, options({ kind: "boilerplate", path: "/p/src/types/a.ts" }));
    expect(text).toContain("boilerplate grant for /p/src/types/a.ts");
    expect(text).toContain("you may write and edit that one file");
    expect(text).toContain("Every other rule still holds");
  });

  it("tells a refactor grant to keep behaviour identical", () => {
    const text = nextReminder(fresh(), 3, options({ kind: "refactor", path: "/p/src/cart.ts" }));
    expect(text).toContain("refactor grant for /p/src/cart.ts");
    expect(text).toContain("keeping its behaviour identical");
  });
});
