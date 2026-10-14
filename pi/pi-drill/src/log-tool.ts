/** The `drill_log` tool: how the mentor records what he learned, quiz answers and reviews. */

import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { LOG_TOOL } from "./gate.ts";
import { appendRecord, type DrillEvent } from "./log.ts";
import type { DrillState } from "./state.ts";

const count = (what: string) =>
  Type.Optional(Type.Integer({ minimum: 0, description: `review: number of ${what} findings` }));

const Params = Type.Object({
  kind: StringEnum(["concept", "quiz", "review"] as const, {
    description: "concept: something he now understands. quiz: one quiz answer. review: one code review.",
  }),
  concept: Type.Optional(
    Type.String({ description: "concept, quiz: short name. Reuse the exact name in later quizzes." }),
  ),
  note: Type.Optional(Type.String({ description: "concept: one line on what he can now explain" })),
  hintLevel: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 3,
      description: "concept: highest hint rung he needed, 0 if unaided",
    }),
  ),
  correct: Type.Optional(Type.Boolean({ description: "quiz: whether his answer was right" })),
  target: Type.Optional(Type.String({ description: "review: the file or change that was reviewed" })),
  blockers: count("BLOCKER"),
  majors: count("MAJOR"),
  minors: count("MINOR"),
});

type LogParams = Static<typeof Params>;

function need<T>(value: T | undefined, field: string, kind: string): T {
  if (value === undefined || value === "") {
    throw new Error(`drill_log: a ${kind} record needs "${field}". Call again with it set.`);
  }
  return value;
}

/** Builds the log record for `params`, or throws naming the first missing field. */
export function toEvent(params: LogParams): DrillEvent {
  const { kind } = params;
  if (kind === "concept") {
    return {
      kind,
      concept: need(params.concept, "concept", kind),
      note: need(params.note, "note", kind),
      hintLevel: need(params.hintLevel, "hintLevel", kind),
    };
  }
  if (kind === "quiz") {
    return {
      kind,
      concept: need(params.concept, "concept", kind),
      correct: need(params.correct, "correct", kind),
    };
  }
  return {
    kind,
    target: need(params.target, "target", kind),
    blockers: params.blockers ?? 0,
    majors: params.majors ?? 0,
    minors: params.minors ?? 0,
  };
}

/** Creates the tool. It appends to the learning log and touches nothing else. */
export function createLogTool(state: DrillState) {
  return defineTool({
    name: LOG_TOOL,
    label: "Drill log",
    description:
      "Record his progress: a concept he now understands, a quiz answer, or the defect counts of a review.",
    parameters: Params,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    execute: (_toolCallId, params) => {
      const event = toEvent(params);
      appendRecord(state.logFile, event, state.now());
      return Promise.resolve({
        content: [{ type: "text" as const, text: `Logged ${event.kind}.` }],
        details: undefined,
      });
    },
  });
}
