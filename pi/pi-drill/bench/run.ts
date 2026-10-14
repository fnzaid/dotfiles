/**
 * Command line for the adherence benchmark.
 *
 *   node bench/run.ts --model deepseek/deepseek-flash
 *   node bench/run.ts --model anthropic/claude-sonnet-5 --thinking high --threshold 0.95
 *
 * It uses the credentials Pi already has (`/login` or the provider's environment variable)
 * and exits 1 when the model fails the gate.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { CASES } from "./cases.ts";
import { formatResult, openPiSession, runBench } from "./core.ts";

const FIXTURE = new URL("./fixture", import.meta.url).pathname;
const RESULTS = new URL("./results", import.meta.url).pathname;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    thinking: { type: "string" },
    threshold: { type: "string", default: "0.95" },
    case: { type: "string", multiple: true },
  },
});

const [provider, ...idParts] = (values.model ?? "").split("/");
const modelId = idParts.join("/");
if (!provider || !modelId) fail("Usage: node bench/run.ts --model <provider>/<model id> [--thinking high]");

const threshold = Number(values.threshold);
if (!(threshold > 0 && threshold <= 1))
  fail("--threshold must be a number above 0 and at most 1, for example 0.95");

const cases = values.case ? CASES.filter((benchCase) => values.case?.includes(benchCase.id)) : CASES;
if (cases.length === 0)
  fail(`No case matches. Known cases: ${CASES.map((benchCase) => benchCase.id).join(", ")}`);

const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel(provider, modelId);
if (!model)
  fail(`Pi does not know the model ${provider}/${modelId}. Run "pi --list-models" to see the names.`);

// A throwaway agent directory keeps the benchmark out of his real learning log and extensions.
const agentDir = mkdtempSync(join(tmpdir(), "drill-bench-agent-"));
console.log(
  `Benchmarking ${provider}/${modelId} on ${String(cases.length)} cases. Each turn is a real model call.`,
);

try {
  const result = await runBench(cases, {
    fixture: FIXTURE,
    threshold,
    maxCodeLines: DEFAULT_CONFIG.maxCodeLines,
    openSession: (project) =>
      openPiSession({
        project,
        agentDir,
        model,
        modelRuntime,
        ...(values.thinking ? { thinkingLevel: values.thinking as ThinkingLevel } : {}),
      }),
    onProgress: (line) => {
      console.log(line);
    },
  });
  console.log(`\n${formatResult(result, threshold)}`);

  mkdirSync(RESULTS, { recursive: true });
  const name = `${provider}-${modelId.replaceAll("/", "_")}-${new Date().toISOString().slice(0, 10)}.json`;
  const file = join(RESULTS, name);
  writeFileSync(
    file,
    `${JSON.stringify({ model: `${provider}/${modelId}`, threshold, ...result }, null, 2)}\n`,
  );
  console.log(`Saved ${file}`);
  process.exitCode = result.passed ? 0 : 1;
} catch (error) {
  // A missing key or a provider outage is not a benchmark result. Say what stopped the run and exit 2.
  console.error(`Benchmark stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
} finally {
  rmSync(agentDir, { recursive: true });
}
