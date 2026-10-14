/**
 * The slash commands he runs himself.
 *
 * `/boilerplate` and `/refactor` are the only way a file opens for the mentor. They are
 * commands, not prompts, on purpose: the model cannot type a slash command, so it cannot
 * grant itself anything.
 */

import { statSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { checkBoilerplatePath, type Grant, insideProject, resolveToolPath } from "./gate.ts";
import { appendRecord, readLog } from "./log.ts";
import { computeProgress, dueConcepts, formatProgress } from "./progress.ts";
import type { DrillState } from "./state.ts";

/** Quiz length. Three questions fit one sitting and still give spacing something to work with. */
const QUIZ_SIZE = 3;

const FILE_TOOLS = ["write", "edit"];

/** Pi's dedicated read tools. They are off by default, and each one is a shell command the mentor no longer needs. */
const READ_TOOLS = ["grep", "find", "ls"];

/** Takes the file tools away from the model. Called when a grant ends. */
export function lockFileTools(pi: ExtensionAPI): void {
  pi.setActiveTools(pi.getActiveTools().filter((name) => !FILE_TOOLS.includes(name)));
}

/** Sets the mentor's tool set at start-up: Pi's read tools on, the file tools off. */
export function prepareTools(pi: ExtensionAPI): void {
  pi.setActiveTools([...new Set([...pi.getActiveTools(), ...READ_TOOLS])]);
  lockFileTools(pi);
}

/** Ends the open grant, if any, and locks the file tools again. */
export function closeGrant(pi: ExtensionAPI, state: DrillState): void {
  state.grant = undefined;
  lockFileTools(pi);
}

function openGrant(pi: ExtensionAPI, state: DrillState, grant: Grant): void {
  state.grant = grant;
  const tools = grant.kind === "boilerplate" ? FILE_TOOLS : ["edit"];
  pi.setActiveTools([...new Set([...pi.getActiveTools(), ...tools])]);
  appendRecord(state.logFile, { kind: "grant", grant: grant.kind, path: grant.path }, state.now());
}

/** Splits "path the rest of the line" into its two parts. */
function parseArgs(args: string): { path: string; rest: string } {
  const [path = "", ...rest] = args.trim().split(/\s+/);
  return { path, rest: rest.join(" ") };
}

/** Returns why a grant cannot open right now, or undefined when it can. */
function refusal(
  state: DrillState,
  ctx: ExtensionCommandContext,
  path: string,
  usage: string,
): string | undefined {
  if (state.off) return "drill is off for this run (--drill-off). The mentor can already write files.";
  if (path === "") return `Usage: ${usage}`;
  if (!ctx.isIdle()) return "Wait for the mentor to finish, then run this again.";
  return undefined;
}

/** Returns why `target` cannot be refactored, or undefined when it can. */
function notRefactorable(path: string, target: string, cwd: string): string | undefined {
  if (!insideProject(target, cwd)) return `${path} is outside this project`;
  const stats = statSync(target, { throwIfNoEntry: false });
  const hasCode = stats?.isFile() === true && stats.size > 0;
  return hasCode ? undefined : `${path} is not a file with code in it. Write it first.`;
}

function boilerplate(pi: ExtensionAPI, state: DrillState, args: string, ctx: ExtensionCommandContext): void {
  const { path, rest } = parseArgs(args);
  const verdict = checkBoilerplatePath(path, ctx.cwd, state.config.boilerplate);
  const problem =
    refusal(state, ctx, path, "/boilerplate <path> [what it should contain]") ??
    (verdict.allow ? undefined : verdict.reason);
  if (problem !== undefined) {
    ctx.ui.notify(problem, "warning");
    return;
  }
  openGrant(pi, state, { kind: "boilerplate", path: resolveToolPath(path, ctx.cwd) });
  const what = rest === "" ? "Work out the contents from what we discussed." : rest;
  pi.sendUserMessage(`Write the boilerplate file ${path}. ${what}`);
}

function refactor(pi: ExtensionAPI, state: DrillState, args: string, ctx: ExtensionCommandContext): void {
  const { path, rest } = parseArgs(args);
  const target = resolveToolPath(path, ctx.cwd);
  const problem =
    refusal(state, ctx, path, "/refactor <path> [what to focus on]") ??
    notRefactorable(path, target, ctx.cwd);
  if (problem !== undefined) {
    ctx.ui.notify(problem, "warning");
    return;
  }
  openGrant(pi, state, { kind: "refactor", path: target });
  const focus = rest === "" ? "" : ` Focus on: ${rest}.`;
  pi.sendUserMessage(
    `Refactor ${path} to best practice without changing what it does.${focus} ` +
      "Then list each change in one line: what you changed, the practice behind it, and what it prevents.",
  );
}

function quiz(pi: ExtensionAPI, state: DrillState, ctx: ExtensionCommandContext): void {
  const due = dueConcepts(readLog(state.logFile).records, state.now()).slice(0, QUIZ_SIZE);
  if (due.length === 0) {
    ctx.ui.notify(
      "Nothing is due for a quiz. Concepts come back 1, 3, 7, 14 and 30 days after you learn them.",
      "info",
    );
    return;
  }
  const list = due.map((item, index) => `${String(index + 1)}. ${item.concept}: ${item.note}`).join("\n");
  ctx.ui.notify(`Quiz: ${String(due.length)} concepts. Answer from memory.`, "info");
  // Hidden from him: the notes are the answers.
  pi.sendMessage(
    {
      customType: "drill-quiz",
      content: `He ran /quiz. Quiz him on these concepts, one question at a time, and log each answer with drill_log.\n${list}`,
      display: false,
    },
    { triggerTurn: true },
  );
}

function progress(state: DrillState, ctx: ExtensionCommandContext): void {
  ctx.ui.notify(formatProgress(computeProgress(readLog(state.logFile), state.now())), "info");
}

type Handler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

/** Pi expects async command handlers. These commands finish their work synchronously. */
function handler(run: (args: string, ctx: ExtensionCommandContext) => void): Handler {
  return (args, ctx) => {
    run(args, ctx);
    return Promise.resolve();
  };
}

/** Registers `/boilerplate`, `/refactor`, `/quiz` and `/progress`. */
export function registerCommands(pi: ExtensionAPI, state: DrillState): void {
  pi.registerCommand("boilerplate", {
    description: "Let the mentor write one boring file: types, models, logging, config",
    handler: handler((args, ctx) => {
      boilerplate(pi, state, args, ctx);
    }),
  });
  pi.registerCommand("refactor", {
    description: "Let the mentor refactor one file you wrote, behaviour unchanged",
    handler: handler((args, ctx) => {
      refactor(pi, state, args, ctx);
    }),
  });
  pi.registerCommand("quiz", {
    description: "Get quizzed on the concepts that are due",
    handler: handler((_args, ctx) => {
      quiz(pi, state, ctx);
    }),
  });
  pi.registerCommand("progress", {
    description: "Show this week against last week, from the learning log",
    handler: handler((_args, ctx) => {
      progress(state, ctx);
    }),
  });
}
