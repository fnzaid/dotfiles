/**
 * The hard rule, as code: which tool calls the mentor may make.
 *
 * The prompt asks the model not to write feature code. Prompts drift, so this gate does not
 * ask. It runs before every tool call, including calls made from inside a codemode script.
 */

import { homedir } from "node:os";
import { isAbsolute, matchesGlob, relative, resolve } from "node:path";
import type { DrillConfig } from "./config.ts";
import { checkCommand, type Verdict } from "./shell.ts";

/** A one-request permission that only the user can create, by running a command. */
export interface Grant {
  kind: "boilerplate" | "refactor";
  /** Absolute path of the one file the grant covers. */
  path: string;
}

export interface ToolCall {
  toolName: string;
  input: Readonly<Record<string, unknown>>;
}

export interface GateContext {
  cwd: string;
  grant: Grant | undefined;
  config: DrillConfig;
  /** `config.bashAllow`, compiled once. */
  bashAllow: readonly RegExp[];
  /** True when the tool's author marked it as not changing its environment. */
  readOnly: boolean;
}

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const FILE_TOOLS = new Set(["write", "edit"]);

/**
 * Tools that only reach the world through other tools. Each call they make comes back
 * through this gate on its own, so the wrapper itself is safe to allow.
 */
const WRAPPER_TOOLS = new Set(["codemode", "tool_search"]);

/** The mentor's own log tool. It appends to the learning log and nothing else. */
export const LOG_TOOL = "drill_log";

const NO_CODE =
  "Blocked by drill: you do not write his code. Tell him what to write, where, and why, then " +
  "review what he writes. A file opens for you only when he runs /boilerplate or /refactor himself.";

/** Resolves a tool path the way Pi's file tools do: optional `@` prefix, `~`, then the project. */
export function resolveToolPath(path: string, cwd: string): string {
  const bare = path.startsWith("@") ? path.slice(1) : path;
  const expanded = bare === "~" || bare.startsWith("~/") ? homedir() + bare.slice(1) : bare;
  return resolve(cwd, expanded);
}

/** True when the absolute path `absolute` is a file location below the project root. */
export function insideProject(absolute: string, cwd: string): boolean {
  const fromProject = relative(cwd, absolute);
  return fromProject !== "" && !fromProject.startsWith("..") && !isAbsolute(fromProject);
}

/**
 * Says whether `/boilerplate` may open `path`. The file has to sit inside the project and
 * match one of the `boilerplate` globs.
 */
export function checkBoilerplatePath(path: string, cwd: string, patterns: readonly string[]): Verdict {
  const absolute = resolveToolPath(path, cwd);
  if (!insideProject(absolute, cwd)) {
    return { allow: false, reason: `${path} is outside this project` };
  }
  const portable = relative(cwd, absolute).replaceAll("\\", "/");
  if (!patterns.some((pattern) => matchesGlob(portable, pattern))) {
    return {
      allow: false,
      reason: `${path} is not a boilerplate path. Types, models, schemas, logging and config qualify. Write this one yourself, or add a glob to "boilerplate" in drill.json.`,
    };
  }
  return { allow: true };
}

function decideFileWrite(call: ToolCall, ctx: GateContext): Verdict {
  const { grant } = ctx;
  if (grant === undefined) return { allow: false, reason: NO_CODE };

  const target = typeof call.input.path === "string" ? resolveToolPath(call.input.path, ctx.cwd) : undefined;
  if (target !== grant.path) {
    return { allow: false, reason: `Blocked by drill: this grant covers ${grant.path} and nothing else.` };
  }
  if (grant.kind === "refactor" && call.toolName === "write") {
    return { allow: false, reason: "Blocked by drill: a refactor grant allows edit, not a full rewrite." };
  }
  return { allow: true };
}

function decideShell(call: ToolCall, ctx: GateContext): Verdict {
  const command = typeof call.input.command === "string" ? call.input.command : "";
  const verdict = checkCommand(command, ctx.bashAllow);
  if (verdict.allow) return verdict;
  return { allow: false, reason: `Blocked by drill: ${verdict.reason}. You may read and run checks.` };
}

/**
 * Decides one tool call. Unknown tools are blocked unless their author marked them
 * read-only or the user listed them in `allowTools`.
 */
export function decide(call: ToolCall, ctx: GateContext): Verdict {
  const name = call.toolName;
  if (FILE_TOOLS.has(name)) return decideFileWrite(call, ctx);
  if (SHELL_TOOLS.has(name)) return decideShell(call, ctx);

  const known = READ_TOOLS.has(name) || WRAPPER_TOOLS.has(name) || name === LOG_TOOL;
  if (known || ctx.readOnly || ctx.config.allowTools.includes(name)) return { allow: true };

  return {
    allow: false,
    reason: `Blocked by drill: "${name}" is not on the allowlist. He can add it to "allowTools" in drill.json.`,
  };
}
