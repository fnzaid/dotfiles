/**
 * Finds code the mentor put in a chat reply and cuts it out.
 *
 * The tool gate stops the model writing files. It cannot stop the model pasting a finished
 * function into the conversation, which teaches just as little. A short block is fine: it
 * can show an API shape or quote the line under review. A long one is a solution.
 */

/** Fence labels that mark prose or program output, not code. */
const NOT_CODE = new Set(["text", "txt", "plain", "plaintext", "log", "console", "output", "md", "markdown"]);

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;

interface Block {
  /** Index of the opening fence line. */
  start: number;
  /** Index of the closing fence line, or of the last line when the fence never closes. */
  end: number;
  language: string;
  /** Non-blank lines between the fences. */
  codeLines: number;
}

export interface Redaction {
  /** The reply with every over-long code block replaced by a one-line notice. */
  text: string;
  /** Total code lines removed. Zero means the reply was clean. */
  removedLines: number;
}

function findBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let open: { start: number; marker: string; language: string } | undefined;

  lines.forEach((line, index) => {
    const fence = FENCE.exec(line);
    const marker = fence?.[1];
    if (marker === undefined) return;
    const language = (fence?.[2] ?? "").toLowerCase();
    if (open === undefined) {
      open = { start: index, marker, language };
    } else if (marker.startsWith(open.marker) && language === "") {
      blocks.push(closeBlock(lines, open, index));
      open = undefined;
    }
  });

  // A reply cut off mid-block still leaked whatever came before the cut.
  if (open !== undefined) blocks.push(closeBlock(lines, open, lines.length));
  return blocks;
}

function closeBlock(
  lines: readonly string[],
  open: { start: number; language: string },
  closingIndex: number,
): Block {
  const body = lines.slice(open.start + 1, closingIndex);
  return {
    start: open.start,
    end: Math.min(closingIndex, lines.length - 1),
    language: open.language,
    codeLines: body.filter((line) => line.trim() !== "").length,
  };
}

/**
 * Replaces each code block longer than `maxCodeLines` with a notice the model will read on
 * its next turn. Blocks labelled as text or program output are left alone.
 */
export function redactCode(text: string, maxCodeLines: number): Redaction {
  const lines = text.split("\n");
  const leaks = findBlocks(lines).filter(
    (block) => !NOT_CODE.has(block.language) && block.codeLines > maxCodeLines,
  );
  if (leaks.length === 0) return { text, removedLines: 0 };

  // Work from the bottom so earlier indexes stay valid while lines are replaced.
  for (const block of leaks.toReversed()) {
    const notice = `[drill removed ${String(block.codeLines)} lines of code. The mentor does not write his code. Give the next hint, not the solution.]`;
    lines.splice(block.start, block.end - block.start + 1, notice);
  }
  const removedLines = leaks.reduce((sum, block) => sum + block.codeLines, 0);
  return { text: lines.join("\n"), removedLines };
}
