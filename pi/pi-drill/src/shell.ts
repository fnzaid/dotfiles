/**
 * Decides whether a shell command is safe for the mentor to run.
 *
 * The mentor may read the repo and run the test and lint tools. It may not create or change
 * files, because a shell that can write is a back door around the write gate. This is an
 * allowlist for an eager model. It is not a sandbox: a command on the list can still run
 * code from the repo (that is what `npm test` does).
 *
 * This file reads the command the way a shell would and splits it into simple commands.
 * Which commands and options are allowed is data, in shell-rules.ts.
 */

import { FAMILIES, type Family } from "./shell-rules.ts";

export type Verdict = { allow: true } | { allow: false; reason: string };

/**
 * Longer than any read-only one-liner. The cap also bounds how long the patterns here, and
 * the user's own `bashAllow` patterns, can spend on one command.
 */
const MAX_COMMAND_LENGTH = 2000;

/** Redirects that discard or merge output. They write nothing a person would keep. */
const HARMLESS_REDIRECT = /\s*(?:2>&1|[12&]?>\s*\/dev\/null)(?![\w/.-])/g;

/**
 * One backslash escape, the opening of a `$'...'` or `$"..."` string, a single-quoted string
 * or a double-quoted string. The alternation is tried left to right at each position, which
 * is the order a shell reads quoting in.
 */
const QUOTING = /\\([\s\S])|\$['"]|'([^']*)'|"((?:[^"\\]|\\[\s\S])*)"/g;

const SEPARATOR = /&&|\|\||[;|\n]/;

/**
 * The start of a variable, `${...}`, `$(...)` or backtick expansion. An expansion can turn
 * into an option after the gate has looked: `${X:---fix}` reaches the tool as `--fix`.
 */
const EXPANSION = /\$[\w{([@*#?!$-]|`/;

/**
 * An unquoted brace. The shell expands `{--write,src.js}` into two words after the gate has
 * looked, so a word that starts with `{` can become an option. Quoted braces are untouched.
 */
const BRACE = /[{}]/;

/** File redirection, a here-document, process substitution, or a background job. */
const WRITES_OR_DETACHES = /[<>]|(?<!&)&(?!&)/;

/**
 * Environment variables a command may be prefixed with. Any other name is refused, because
 * variables such as GIT_EXTERNAL_DIFF and PAGER name a program for the command to run.
 */
const HARMLESS_ENV = /^(?:(?:CI|NODE_ENV|FORCE_COLOR|NO_COLOR|TZ|LANG|LC_ALL|RUST_BACKTRACE|DEBUG)=\S* )+/;

/** An unquoted `#` at the start of a word. The shell ignores the rest of the line. */
const COMMENT = /(^|\s)#[^\n]*/g;

/** Replaces every character that has a meaning to the shell with a placeholder. */
function inert(text: string): string {
  return text.replace(/[|;&<>\n`$(#]/g, "_");
}

/** True when the command contains an expansion the shell would perform. */
function expands(bare: string): boolean {
  const quoted = [...bare.matchAll(QUOTING)];
  // `$'\x2d\x2dfix'` is decoded by the shell into `--fix`, so that quoting style is refused outright.
  const decodes = quoted.some(([match]) => match === "$'" || match === '$"');
  // Expansion still runs inside double quotes. Single quotes and escapes switch it off.
  const inDoubleQuotes = quoted.some(([, , , double]) => double !== undefined && EXPANSION.test(double));
  const unquoted = bare.replace(QUOTING, " ");
  return decodes || inDoubleQuotes || EXPANSION.test(unquoted) || BRACE.test(unquoted);
}

/**
 * Removes quoting so the command can be split on shell separators and into words.
 *
 * Shell characters inside quotes or after a backslash become `_`, so `grep "a|b" f` stays
 * one command while a quoted `--fix` is still visible to the option rules. Returns undefined
 * when the command uses a construct the gate refuses to reason about.
 */
function flatten(command: string): string | undefined {
  const bare = command.replace(HARMLESS_REDIRECT, "");
  if (expands(bare)) return undefined;

  // Comments go after quoting is resolved, so a quoted `#` is not mistaken for one. What the
  // gate checks is then exactly what the shell runs: `tsc # --noEmit` is checked as `tsc`.
  const flat = bare
    .replace(QUOTING, (_match, escaped?: string, single?: string, double?: string) =>
      inert(escaped ?? single ?? double ?? ""),
    )
    .replace(COMMENT, "$1");
  const unbalanced = /['"]/.test(flat);
  return unbalanced || WRITES_OR_DETACHES.test(flat) ? undefined : flat;
}

/** Returns the first option the family does not accept, if there is one. */
function unlistedOption(family: Family, simple: string): string | undefined {
  const { options, glue } = family;
  if (options === undefined) return undefined;
  // `--format json` is checked as `--format=json`, so the value is held to the same list.
  const args = glue ? simple.replace(glue, " $1=") : simple;
  const words = args.replace(family.head, "").split(" ");
  return words.find((word) => word.startsWith("-") && word !== "-" && word !== "--" && !options.test(word));
}

function checkSimpleCommand(segment: string, extraAllow: readonly RegExp[]): Verdict {
  const simple = segment.trim().replace(/\s+/g, " ").replace(HARMLESS_ENV, "");
  // His own patterns are the whole rule for the commands they match.
  if (extraAllow.some((pattern) => pattern.test(simple))) return { allow: true };

  const family = FAMILIES.find((candidate) => candidate.head.test(simple));
  if (family === undefined) {
    return { allow: false, reason: `"${simple}" is not on the read-only command list` };
  }
  if (family.refuse?.test(simple) === true) {
    return { allow: false, reason: `"${simple}" would write a file or run another program` };
  }
  const option = unlistedOption(family, simple);
  if (option !== undefined) {
    return { allow: false, reason: `the option "${option}" is not on the list for "${simple}"` };
  }
  return { allow: true };
}

/**
 * Checks every simple command in `command`. One failing part blocks the whole line.
 *
 * `extraAllow` holds the user's own patterns from the `bashAllow` setting.
 */
export function checkCommand(command: string, extraAllow: readonly RegExp[]): Verdict {
  if (command.length > MAX_COMMAND_LENGTH) {
    return { allow: false, reason: `the command is over ${String(MAX_COMMAND_LENGTH)} characters` };
  }
  const flat = flatten(command);
  if (flat === undefined) {
    return {
      allow: false,
      reason: "redirection, variables, braces, command substitution and background jobs are off",
    };
  }
  const segments = flat.split(SEPARATOR).filter((segment) => segment.trim() !== "");
  if (segments.length === 0) return { allow: false, reason: "the command is empty" };

  for (const segment of segments) {
    const verdict = checkSimpleCommand(segment, extraAllow);
    if (!verdict.allow) return verdict;
  }
  return { allow: true };
}
