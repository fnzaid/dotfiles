/**
 * Loads and validates the drill settings.
 *
 * Settings are read from `<agent dir>/drill.json`, then `<project>/.pi/drill.json`. A key in
 * the project file replaces the same key in the personal file. A file with any bad value is
 * ignored as a whole and reported, so a typo can never loosen the gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const ConfigSchema = Type.Object(
  {
    /** Globs, relative to the project, where `/boilerplate` may grant a write. */
    boilerplate: Type.Array(Type.String({ minLength: 1 })),
    /** Extra regular expressions for shell commands the mentor may run. */
    bashAllow: Type.Array(Type.String({ minLength: 1 })),
    /** Extra tool names the mentor may always call. */
    allowTools: Type.Array(Type.String({ minLength: 1 })),
    /** Longest code block, in non-blank lines, the mentor may put in a reply. */
    maxCodeLines: Type.Integer({ minimum: 0, maximum: 200 }),
    /** What happens to a longer block: cut it from the reply, or only record it. */
    leakAction: Type.Union([Type.Literal("redact"), Type.Literal("warn")]),
    /** Context usage percentages at which the full rule digest is sent again. */
    fullRulesAt: Type.Array(Type.Integer({ minimum: 1, maximum: 99 })),
  },
  { additionalProperties: false },
);

const PartialConfigSchema = Type.Partial(ConfigSchema, { additionalProperties: false });

export type DrillConfig = Static<typeof ConfigSchema>;

export const DEFAULT_CONFIG: DrillConfig = {
  boilerplate: [
    "**/types/**",
    "**/types.*",
    "**/*.types.*",
    "**/*.d.ts",
    "**/models/**",
    "**/model/**",
    "**/models.*",
    "**/*.model.*",
    "**/schemas/**",
    "**/schema.*",
    "**/*.schema.*",
    "**/dto/**",
    "**/*.dto.*",
    "**/logging/**",
    "**/logger.*",
    "**/logging.*",
    "**/*.config.*",
    "**/tsconfig*.json",
    "**/.env.example",
    "**/.gitignore",
    "**/.editorconfig",
  ],
  bashAllow: [],
  allowTools: [],
  maxCodeLines: 6,
  leakAction: "redact",
  fullRulesAt: [25, 50, 75],
};

export interface LoadedConfig {
  config: DrillConfig;
  /** One line per problem, each naming the file and the bad value. */
  errors: string[];
}

function badPatterns(file: string, patterns: readonly string[]): string[] {
  const errors: string[] = [];
  for (const source of patterns) {
    try {
      new RegExp(source);
    } catch {
      errors.push(`${file}: bashAllow "${source}" is not a valid regular expression`);
    }
  }
  return errors;
}

function readOverrides(file: string): { overrides: Partial<DrillConfig>; errors: string[] } {
  if (!existsSync(file)) return { overrides: {}, errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { overrides: {}, errors: [`${file}: not valid JSON (${String(error)})`] };
  }
  if (!Value.Check(PartialConfigSchema, parsed)) {
    const problems = [...Value.Errors(PartialConfigSchema, parsed)];
    const errors = problems.map((problem) => `${file}: ${problem.instancePath || "/"} ${problem.message}`);
    return { overrides: {}, errors };
  }
  const errors = badPatterns(file, parsed.bashAllow ?? []);
  return errors.length > 0 ? { overrides: {}, errors } : { overrides: parsed, errors };
}

/**
 * Reads both settings files and merges them over the defaults.
 *
 * Never throws. A file that fails validation contributes nothing, and every problem in it
 * comes back in `errors` for the caller to show.
 */
export function loadConfig(cwd: string, agentDir: string): LoadedConfig {
  const personal = readOverrides(join(agentDir, "drill.json"));
  const project = readOverrides(join(cwd, ".pi", "drill.json"));
  return {
    config: { ...DEFAULT_CONFIG, ...personal.overrides, ...project.overrides },
    errors: [...personal.errors, ...project.errors],
  };
}
