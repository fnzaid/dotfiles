/**
 * A scripted "model" for the smoke test. It behaves the way drill exists to stop: it tries
 * to write a file with the write tool, then with the shell, then pastes a solution.
 *
 * Loaded only by scripts/smoke.sh, with `pi -e`. It needs no API key and no network.
 */

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SOLUTION = ["```ts", ...Array.from({ length: 10 }, () => "handle(request);"), "```"].join("\n");

export default function scriptedModel(pi: ExtensionAPI): void {
  const faux = fauxProvider({ provider: "scripted", models: [{ id: "bad-mentor" }] });
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("write", { path: "src/handler.ts", content: "export const handler = 1;\n" }),
        fauxToolCall("bash", { command: "printf 'export const handler = 1;' > src/handler.ts" }),
        fauxToolCall("bash", { command: "cat README.md" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(`Here is the handler:\n${SOLUTION}`),
  ]);
  pi.registerProvider(faux.provider);
}
