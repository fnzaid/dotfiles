import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { checkBoilerplatePath, decide, type GateContext, type Grant, resolveToolPath } from "../src/gate.ts";

const CWD = "/work/shop";

function context(overrides: Partial<GateContext> = {}): GateContext {
  return { cwd: CWD, grant: undefined, config: DEFAULT_CONFIG, bashAllow: [], readOnly: false, ...overrides };
}

const boilerplate: Grant = { kind: "boilerplate", path: `${CWD}/src/types/order.ts` };
const refactor: Grant = { kind: "refactor", path: `${CWD}/src/cart.ts` };

describe("decide", () => {
  it.each(["read", "grep", "find", "ls", "codemode", "tool_search", "drill_log"])("allows %s", (toolName) => {
    expect(decide({ toolName, input: {} }, context())).toEqual({ allow: true });
  });

  it.each(["write", "edit"])("blocks %s when he has opened no grant", (toolName) => {
    const verdict = decide({ toolName, input: { path: "src/cart.ts" } }, context());
    expect(verdict).toMatchObject({
      allow: false,
      reason: expect.stringContaining("you do not write his code"),
    });
  });

  it("allows write and edit on the file a boilerplate grant covers", () => {
    const ctx = context({ grant: boilerplate });
    expect(decide({ toolName: "write", input: { path: "src/types/order.ts" } }, ctx).allow).toBe(true);
    expect(decide({ toolName: "edit", input: { path: `${CWD}/src/types/order.ts` } }, ctx).allow).toBe(true);
    expect(decide({ toolName: "write", input: { path: "@src/types/order.ts" } }, ctx).allow).toBe(true);
  });

  it("blocks a write to any other file while a grant is open", () => {
    const verdict = decide(
      { toolName: "write", input: { path: "src/cart.ts" } },
      context({ grant: boilerplate }),
    );
    expect(verdict).toMatchObject({ allow: false, reason: expect.stringContaining("and nothing else") });
  });

  it("blocks a write whose path is missing", () => {
    expect(decide({ toolName: "write", input: {} }, context({ grant: boilerplate })).allow).toBe(false);
  });

  it("lets a refactor grant edit its file but not rewrite it", () => {
    const ctx = context({ grant: refactor });
    expect(decide({ toolName: "edit", input: { path: "src/cart.ts" } }, ctx).allow).toBe(true);
    expect(decide({ toolName: "write", input: { path: "src/cart.ts" } }, ctx)).toMatchObject({
      allow: false,
      reason: expect.stringContaining("not a full rewrite"),
    });
  });

  it.each(["bash", "powershell"])("lets %s read and blocks it writing", (toolName) => {
    expect(decide({ toolName, input: { command: "git status" } }, context()).allow).toBe(true);
    expect(decide({ toolName, input: { command: "echo x > a.ts" } }, context())).toMatchObject({
      allow: false,
      reason: expect.stringContaining("You may read and run checks"),
    });
  });

  it("blocks a shell call with no command", () => {
    expect(decide({ toolName: "bash", input: {} }, context()).allow).toBe(false);
  });

  it("keeps the shell read-only even while a grant is open", () => {
    const verdict = decide(
      { toolName: "bash", input: { command: "cp a src/types/order.ts" } },
      context({ grant: boilerplate }),
    );
    expect(verdict.allow).toBe(false);
  });

  it("applies the user's extra shell patterns", () => {
    const ctx = context({ bashAllow: [/^terraform plan$/] });
    expect(decide({ toolName: "bash", input: { command: "terraform plan" } }, ctx).allow).toBe(true);
  });

  it("blocks an unknown tool and names the setting that would allow it", () => {
    const verdict = decide({ toolName: "mcp__github__create_pr", input: {} }, context());
    expect(verdict).toMatchObject({ allow: false, reason: expect.stringContaining("allowTools") });
  });

  it("allows an unknown tool its author marked read-only", () => {
    expect(decide({ toolName: "mcp__docs__search", input: {} }, context({ readOnly: true })).allow).toBe(
      true,
    );
  });

  it("allows a tool the user listed in allowTools", () => {
    const config = { ...DEFAULT_CONFIG, allowTools: ["mcp__github__create_pr"] };
    expect(decide({ toolName: "mcp__github__create_pr", input: {} }, context({ config })).allow).toBe(true);
  });

  it("never lets allowTools or a read-only hint open the file tools", () => {
    const config = { ...DEFAULT_CONFIG, allowTools: ["write", "bash"] };
    const ctx = context({ config, readOnly: true });
    expect(decide({ toolName: "write", input: { path: "a.ts" } }, ctx).allow).toBe(false);
    expect(decide({ toolName: "bash", input: { command: "rm a" } }, ctx).allow).toBe(false);
  });
});

describe("resolveToolPath", () => {
  it("resolves relative paths against the project", () => {
    expect(resolveToolPath("src/a.ts", CWD)).toBe(`${CWD}/src/a.ts`);
  });

  it("keeps absolute paths and normalises them", () => {
    expect(resolveToolPath("/etc/../tmp/a", CWD)).toBe("/tmp/a");
  });

  it("expands the home directory", () => {
    expect(resolveToolPath("~/a.ts", CWD)).toBe(`${homedir()}/a.ts`);
    expect(resolveToolPath("~", CWD)).toBe(homedir());
  });
});

describe("checkBoilerplatePath", () => {
  const patterns = DEFAULT_CONFIG.boilerplate;

  it.each([
    "src/types/order.ts",
    "types.go",
    "src/order.types.ts",
    "global.d.ts",
    "internal/models/user.go",
    "app/models.py",
    "src/user.model.ts",
    "db/schema.sql",
    "src/logging/setup.ts",
    "src/logger.ts",
    "vite.config.ts",
    "tsconfig.build.json",
    ".env.example",
  ])("accepts %s", (path) => {
    expect(checkBoilerplatePath(path, CWD, patterns)).toEqual({ allow: true });
  });

  it.each([
    "src/cart.ts",
    "internal/payments/retry.go",
    "src/handlers/order.ts",
    "test/cart.test.ts",
    ".env",
  ])("refuses %s as feature code", (path) => {
    expect(checkBoilerplatePath(path, CWD, patterns)).toMatchObject({
      allow: false,
      reason: expect.stringContaining("not a boilerplate path"),
    });
  });

  it.each(["../other/types/a.ts", "/etc/types/a.ts", ".", "~/types/a.ts"])(
    "refuses %s as outside the project",
    (path) => {
      expect(checkBoilerplatePath(path, CWD, patterns)).toMatchObject({
        allow: false,
        reason: expect.stringContaining("outside this project"),
      });
    },
  );
});
