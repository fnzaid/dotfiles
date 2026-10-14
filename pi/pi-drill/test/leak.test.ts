import { describe, expect, it } from "vitest";
import { redactCode } from "../src/leak.ts";

const code = (lines: number, fence = "```", language = "ts"): string =>
  [
    `${fence}${language}`,
    ...Array.from({ length: lines }, (_, i) => `const v${String(i)} = ${String(i)};`),
    fence,
  ].join("\n");

describe("redactCode", () => {
  it("leaves a reply without code untouched", () => {
    expect(redactCode("No. What did you try?", 6)).toEqual({
      text: "No. What did you try?",
      removedLines: 0,
    });
  });

  it("leaves a block at the limit in place", () => {
    const reply = `The call has this shape:\n${code(6)}\nNow use it.`;
    expect(redactCode(reply, 6)).toEqual({ text: reply, removedLines: 0 });
  });

  it("cuts a block over the limit and says so where the model will read it", () => {
    const result = redactCode(`Here you go:\n${code(7)}\nDone.`, 6);
    expect(result.removedLines).toBe(7);
    expect(result.text).toBe(
      "Here you go:\n[drill removed 7 lines of code. The mentor does not write his code. Give the next hint, not the solution.]\nDone.",
    );
  });

  it("does not count blank lines as code", () => {
    const block = ["```go", "a := 1", "", "", "b := 2", "", "c := 3", "```"].join("\n");
    expect(redactCode(block, 3).removedLines).toBe(0);
    expect(redactCode(block, 2).removedLines).toBe(3);
  });

  it("cuts every long block and keeps the short ones", () => {
    const reply = [code(10), "Shape:", code(2), "And:", code(8, "~~~", "python")].join("\n");
    const result = redactCode(reply, 6);
    expect(result.removedLines).toBe(18);
    expect(result.text.match(/drill removed/g)).toHaveLength(2);
    expect(result.text).toContain("const v1 = 1;");
  });

  it.each(["text", "console", "log", "output", "markdown", "TEXT"])("leaves a %s block alone", (language) => {
    expect(redactCode(code(30, "```", language), 6).removedLines).toBe(0);
  });

  it("treats a block with no language as code", () => {
    expect(redactCode(code(9, "```", ""), 6).removedLines).toBe(9);
  });

  it("cuts a block that never closes", () => {
    const reply = `Start:\n\`\`\`rust\n${"let x = 1;\n".repeat(9)}`;
    const result = redactCode(reply, 6);
    expect(result.removedLines).toBe(9);
    expect(result.text.startsWith("Start:\n[drill removed 9 lines")).toBe(true);
  });

  it("does not let a fence inside a block close it", () => {
    const reply = [
      "````md",
      "```ts",
      ...Array.from({ length: 8 }, () => "x();"),
      "```",
      "````",
      "after",
    ].join("\n");
    expect(redactCode(reply, 6).removedLines).toBe(0);
    const asCode = reply.replace("````md", "````ts");
    expect(redactCode(asCode, 6).text).toBe(
      "[drill removed 10 lines of code. The mentor does not write his code. Give the next hint, not the solution.]\nafter",
    );
  });

  it("cuts every block when the limit is zero", () => {
    expect(redactCode(code(1), 0).removedLines).toBe(1);
  });
});
