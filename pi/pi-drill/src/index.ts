/**
 * drill: reverse mentor mode for Pi.
 *
 * The model reviews and teaches. He writes the code. This file wires four mechanisms into
 * Pi's event hooks:
 *
 *   before_agent_start  installs the mentor prompt and appends the rule reminder
 *   tool_call           blocks every call that would write code (the hard gate)
 *   message_end         cuts solutions out of chat replies
 *   agent_settled       closes the grant he opened for one request
 */

import { readFileSync } from "node:fs";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  getAgentDir,
  type MessageEndEvent,
  type MessageEndEventResult,
  type ToolCallEvent,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { closeGrant, prepareTools, registerCommands } from "./commands.ts";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";
import { decide } from "./gate.ts";
import { redactCode } from "./leak.ts";
import { appendRecord, logFile, readLog } from "./log.ts";
import { createLogTool } from "./log-tool.ts";
import { dueConcepts } from "./progress.ts";
import { nextReminder } from "./reminder.ts";
import type { DrillState } from "./state.ts";

export interface DrillOptions {
  /** The clock. Defaults to the system clock. */
  now?: () => Date;
  /** Pi's agent directory. Defaults to the one Pi itself uses. */
  agentDir?: string;
}

const MENTOR_PROMPT = readFileSync(new URL("../mentor.md", import.meta.url), "utf8");

function onSessionStart(pi: ExtensionAPI, state: DrillState, agentDir: string, ctx: ExtensionContext): void {
  state.off = pi.getFlag("drill-off") === true;
  if (state.off) {
    appendRecord(state.logFile, { kind: "bypass" }, state.now());
    ctx.ui.notify(
      "drill is OFF for this run. The mentor can write code. This run is logged as a bypass.",
      "warning",
    );
    return;
  }
  const loaded = loadConfig(ctx.cwd, agentDir);
  state.config = loaded.config;
  state.bashAllow = loaded.config.bashAllow.map((source) => new RegExp(source));
  for (const error of loaded.errors) ctx.ui.notify(`drill settings ignored: ${error}`, "error");

  prepareTools(pi);
  appendRecord(state.logFile, { kind: "session" }, state.now());
  const due = dueConcepts(readLog(state.logFile).records, state.now()).length;
  if (due > 0) ctx.ui.notify(`${String(due)} concepts are due. Run /quiz before you start.`, "info");
}

function onBeforeAgentStart(
  state: DrillState,
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
): BeforeAgentStartEventResult | undefined {
  if (state.off) return undefined;
  // The same text on every run, so the provider's cached prefix stays valid.
  event.systemPromptOptions.customPrompt = MENTOR_PROMPT.replace(
    "{{MAX_CODE_LINES}}",
    String(state.config.maxCodeLines),
  );
  if (event.messageType !== "user") return undefined;

  const content = nextReminder(state.reminder, ctx.getContextUsage()?.percent ?? undefined, {
    fullRulesAt: state.config.fullRulesAt,
    maxCodeLines: state.config.maxCodeLines,
    grant: state.grant,
  });
  return { message: { customType: "drill-rules", content, display: false } };
}

function onToolCall(
  pi: ExtensionAPI,
  state: DrillState,
  event: ToolCallEvent,
  cwd: string,
): ToolCallEventResult {
  if (state.off) return {};
  const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
  const verdict = decide(
    { toolName: event.toolName, input: event.input },
    {
      cwd,
      grant: state.grant,
      config: state.config,
      bashAllow: state.bashAllow,
      readOnly: tool?.annotations?.readOnlyHint === true,
    },
  );
  return verdict.allow ? {} : { block: true, reason: verdict.reason };
}

/** Cuts solutions out of an assistant reply. Returns the cleaned message and the lines removed. */
function redactMessage(
  message: AssistantMessage,
  maxCodeLines: number,
): { message: AssistantMessage; removed: number } {
  let removed = 0;
  const content = message.content.map((block) => {
    if (block.type !== "text") return block;
    const result = redactCode(block.text, maxCodeLines);
    if (result.removedLines === 0) return block;
    removed += result.removedLines;
    // The provider's signature vouches for the original text, so it cannot travel with the edited one.
    return { type: "text" as const, text: result.text };
  });
  return { message: { ...message, content }, removed };
}

function onMessageEnd(
  state: DrillState,
  event: MessageEndEvent,
  ctx: ExtensionContext,
): MessageEndEventResult | undefined {
  // During a grant the mentor is allowed to show the file it is writing.
  if (state.off || state.grant !== undefined || event.message.role !== "assistant") return undefined;

  const { message, removed } = redactMessage(event.message, state.config.maxCodeLines);
  if (removed === 0) return undefined;

  appendRecord(state.logFile, { kind: "leak", lines: removed }, state.now());
  const redact = state.config.leakAction === "redact";
  const outcome = redact ? "Cut from the reply." : "Left in place (leakAction is warn).";
  ctx.ui.notify(`The mentor wrote ${String(removed)} lines of solution code. ${outcome}`, "warning");
  return redact ? { message } : undefined;
}

/** Builds the extension. Exposed so tests can set the clock and the agent directory. */
export function createDrill(options: DrillOptions = {}): ExtensionFactory {
  return (pi) => {
    const agentDir = options.agentDir ?? getAgentDir();
    const state: DrillState = {
      off: false,
      config: DEFAULT_CONFIG,
      bashAllow: [],
      grant: undefined,
      reminder: { sentAt: new Set(), afterCompaction: false },
      logFile: logFile(agentDir),
      now: options.now ?? (() => new Date()),
    };

    pi.registerFlag("drill-off", {
      description: "Run without the mentor rules (logged as a bypass)",
      type: "boolean",
      default: false,
    });
    pi.registerTool(createLogTool(state));
    registerCommands(pi, state);

    pi.on("session_start", (_event, ctx) => {
      onSessionStart(pi, state, agentDir, ctx);
    });
    pi.on("before_agent_start", (event, ctx) => onBeforeAgentStart(state, event, ctx));
    pi.on("tool_call", (event, ctx) => onToolCall(pi, state, event, ctx.cwd));
    pi.on("message_end", (event, ctx) => onMessageEnd(state, event, ctx));
    pi.on("agent_settled", () => {
      if (!state.off) closeGrant(pi, state);
    });
    pi.on("session_compact", () => {
      state.reminder.afterCompaction = true;
      state.reminder.sentAt.clear();
    });
  };
}

export default createDrill();
