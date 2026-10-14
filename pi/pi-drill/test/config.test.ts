import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";

let project: string;
let agentDir: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "drill-project-"));
  agentDir = mkdtempSync(join(tmpdir(), "drill-agent-"));
  mkdirSync(join(project, ".pi"));
});

afterEach(() => {
  rmSync(project, { recursive: true });
  rmSync(agentDir, { recursive: true });
});

const personal = (value: unknown): void => {
  writeFileSync(join(agentDir, "drill.json"), JSON.stringify(value));
};
const projectFile = (value: unknown): void => {
  writeFileSync(join(project, ".pi", "drill.json"), JSON.stringify(value));
};

describe("loadConfig", () => {
  it("returns the defaults when neither file exists", () => {
    expect(loadConfig(project, agentDir)).toEqual({ config: DEFAULT_CONFIG, errors: [] });
  });

  it("applies personal settings over the defaults", () => {
    personal({ maxCodeLines: 3, leakAction: "warn" });
    const { config, errors } = loadConfig(project, agentDir);
    expect(errors).toEqual([]);
    expect(config).toEqual({ ...DEFAULT_CONFIG, maxCodeLines: 3, leakAction: "warn" });
  });

  it("lets a project key replace the same personal key and keeps the rest", () => {
    personal({ maxCodeLines: 3, allowTools: ["mcp__docs__search"] });
    projectFile({ maxCodeLines: 10, boilerplate: ["proto/**"] });
    const { config } = loadConfig(project, agentDir);
    expect(config.maxCodeLines).toBe(10);
    expect(config.allowTools).toEqual(["mcp__docs__search"]);
    expect(config.boilerplate).toEqual(["proto/**"]);
  });

  it("ignores a file that is not JSON and reports it", () => {
    writeFileSync(join(agentDir, "drill.json"), "{ maxCodeLines: 3 ");
    const { config, errors } = loadConfig(project, agentDir);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("drill.json: not valid JSON");
  });

  it("reports every bad value in a file and ignores the whole file", () => {
    projectFile({ maxCodeLines: -1, leakAction: "delete", fullRulesAt: [120], colour: "red" });
    const { config, errors } = loadConfig(project, agentDir);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors.join("\n")).toContain("/maxCodeLines must be >= 0");
    expect(errors.join("\n")).toContain("/fullRulesAt/0 must be <= 99");
    expect(errors.join("\n")).toContain("must not have additional properties");
    expect(errors.some((error) => error.includes("/leakAction"))).toBe(true);
  });

  it("rejects a shell pattern that is not a regular expression", () => {
    personal({ bashAllow: ["^terraform plan$", "^(unclosed"] });
    const { config, errors } = loadConfig(project, agentDir);
    expect(config.bashAllow).toEqual([]);
    expect(errors).toEqual([
      expect.stringContaining('bashAllow "^(unclosed" is not a valid regular expression'),
    ]);
  });

  it("keeps a valid file when the other one is broken", () => {
    personal({ maxCodeLines: 4 });
    projectFile({ maxCodeLines: "many" });
    const { config, errors } = loadConfig(project, agentDir);
    expect(config.maxCodeLines).toBe(4);
    expect(errors).toHaveLength(1);
  });
});
