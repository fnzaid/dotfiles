import { describe, expect, it } from "vitest";
import { toEvent } from "../src/log-tool.ts";

describe("toEvent", () => {
  it("builds a concept record", () => {
    expect(
      toEvent({ kind: "concept", concept: "epoll", note: "level vs edge triggered", hintLevel: 0 }),
    ).toEqual({
      kind: "concept",
      concept: "epoll",
      note: "level vs edge triggered",
      hintLevel: 0,
    });
  });

  it("builds a quiz record, including a wrong answer", () => {
    expect(toEvent({ kind: "quiz", concept: "epoll", correct: false })).toEqual({
      kind: "quiz",
      concept: "epoll",
      correct: false,
    });
  });

  it("builds a review record and counts missing severities as zero", () => {
    expect(toEvent({ kind: "review", target: "src/a.ts", blockers: 2 })).toEqual({
      kind: "review",
      target: "src/a.ts",
      blockers: 2,
      majors: 0,
      minors: 0,
    });
  });

  it.each([
    [{ kind: "concept", note: "x", hintLevel: 1 } as const, 'a concept record needs "concept"'],
    [{ kind: "concept", concept: "", note: "x", hintLevel: 1 } as const, 'a concept record needs "concept"'],
    [{ kind: "concept", concept: "x", hintLevel: 1 } as const, 'a concept record needs "note"'],
    [{ kind: "concept", concept: "x", note: "y" } as const, 'a concept record needs "hintLevel"'],
    [{ kind: "quiz", concept: "x" } as const, 'a quiz record needs "correct"'],
    [{ kind: "quiz", correct: true } as const, 'a quiz record needs "concept"'],
    [{ kind: "review", blockers: 1 } as const, 'a review record needs "target"'],
  ])("refuses %j and names the missing field", (params, message) => {
    expect(() => toEvent(params)).toThrow(message);
  });
});
