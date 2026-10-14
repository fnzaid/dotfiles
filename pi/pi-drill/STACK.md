# Tools and versions

Every version below was checked on 2026-10-13, against the npm registry or the project's own source.

## Runtime

| Tool            | Version                                               | Why                                                                           | Source                                                                                                                                                                                                                                                              |
| --------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi coding agent | 1.2.0 (published 2026-10-12)                          | The harness drill extends                                                     | [repo](https://github.com/earendil-works/pi), [extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts) |
| Node            | 22.19 or newer (Pi's own minimum). Tested on 22.22.0. | Pi runs on it. drill uses `path.matchesGlob` and native TypeScript stripping. | Pi's `package.json` `engines`                                                                                                                                                                                                                                       |
| typebox         | whatever Pi ships (1.3.27 in Pi 1.2.0)                | Settings and log schemas. Supplied by Pi, so it is a peer dependency.         | [Pi packages doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)                                                                                                                                                            |

drill has no runtime dependencies of its own.

## Pi APIs used (each verified in Pi 1.2.0 source and exercised by a test)

| API                                                                          | Used for                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------- |
| `before_agent_start`, `systemPromptOptions.customPrompt`, returned `message` | mentor prompt and the appended reminder       |
| `tool_call` returning `{ block, reason }`                                    | the hard gate                                 |
| `message_end` returning a replacement `message`                              | cutting solutions from replies                |
| `agent_settled`                                                              | closing a grant                               |
| `session_start`, `session_compact`                                           | start-up, and the digest after a compaction   |
| `pi.getActiveTools()`, `pi.setActiveTools()`                                 | removing `write` and `edit` from the model    |
| `pi.getAllTools()` and `annotations.readOnlyHint`                            | allowing read-only third-party tools          |
| `pi.registerCommand`, `pi.registerTool`, `pi.registerFlag`, `pi.getFlag`     | slash commands, `drill_log`, `--drill-off`    |
| `pi.sendUserMessage`, `pi.sendMessage(..., { triggerTurn: true })`           | starting the granted request and the quiz     |
| `ctx.getContextUsage()`                                                      | the 25/50/75% thresholds                      |
| `ctx.ui.notify`, `ctx.isIdle()`, `ctx.cwd`                                   | messages to you, and refusing a grant mid-run |
| Package manifest `pi.extensions`, `pi.prompts`                               | loading through `pi install`                  |

## Models

| Fact                                     | Value                                                                                       | Source                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| DeepSeek V4.1 Flash, released 2026-09-10 | API model id `deepseek-flash`. In Pi: `deepseek/deepseek-flash`, key in `DEEPSEEK_API_KEY`. | [DeepSeek change log](https://api-docs.deepseek.com/updates), Pi source `packages/ai/src/providers/deepseek.ts` |
| Price per 1M tokens, peak                | input $0.30, cached input $0.006, output $1.20. Off-peak is half.                           | [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing)                                           |
| Thinking mode                            | on by default. `temperature` has no effect while it is on.                                  | [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode)                                    |

No model was called while building this package.

## Development tools

| Tool                                   | Version  | Why                                                                                                |
| -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| TypeScript                             | 6.0.3    | Type checking. 7.0.2 is the latest, but typescript-eslint 8.71.2 supports only versions below 6.1. |
| typescript-eslint                      | 8.71.2   | `strictTypeChecked` and `stylisticTypeChecked` rule sets                                           |
| ESLint                                 | 10.12.0  | Lint, plus the size and complexity limits                                                          |
| Prettier                               | 3.9.10   | Formatting                                                                                         |
| Vitest                                 | 5.0.4    | Test runner                                                                                        |
| @vitest/coverage-v8                    | 5.0.4    | Coverage, gated at 95%                                                                             |
| @types/node                            | 22.19.19 | Matches the oldest Node that Pi supports                                                           |
| @earendil-works/pi-coding-agent, pi-ai | 1.2.0    | Types, and the real sessions the end-to-end tests run                                              |

## Scanners used for GATES.md

| Tool      | Version    | Note                                                                                                                                                         |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| gitleaks  | 8.21.2     | The version that was to hand, not confirmed as the latest                                                                                                    |
| semgrep   | 1.180.0    | Rules from the [semgrep-rules](https://github.com/semgrep/semgrep-rules) repository at its head on 2026-10-13: `typescript`, `javascript`, `generic/secrets` |
| npm audit | npm 10.9.4 | Against the committed lockfile                                                                                                                               |
