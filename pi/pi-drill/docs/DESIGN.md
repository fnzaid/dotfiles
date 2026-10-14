# How drill works

## The problem

Ask a coding agent for a feature and you get the feature. You also get code in your repo that you cannot explain. drill swaps the roles: the model is the senior reviewer, and you are the one who writes the code.

A prompt alone cannot hold that line. Models drift from their instructions within a few turns, and "just this once" is exactly the kind of pressure they give in to. So the rule lives in two places: the prompt explains it, and code enforces it.

## Four mechanisms

```
you type ──> before_agent_start ──> model ──> tool_call ──> tool runs (or is blocked)
                │                     │
                │                     └──> message_end ──> reply (solutions cut out)
                └─ mentor prompt + rule reminder
```

**1. The prompt** (`mentor.md`, installed in `before_agent_start`). It replaces Pi's default system prompt with the same text on every run, so the provider's prompt cache stays valid.

**2. The reminder** (`src/reminder.ts`). After each message you send, drill appends a hidden message restating the rules. It is one line on an ordinary turn. It is the full seven-rule digest on the first turn after a compaction and each time context usage passes 25, 50 and 75%. Reminders are appended to the conversation and never rewrite earlier text.

**3. The tool gate** (`src/gate.ts`, `src/shell.ts`, run on `tool_call`). At start-up drill removes `write` and `edit` from the model's tool set. Every remaining call is checked:

| Tool                                  | Verdict                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `read`, `grep`, `find`, `ls`          | allowed                                                                                                 |
| `bash`, `powershell`                  | allowed only if every command on the line is listed and uses only listed options (`src/shell-rules.ts`) |
| `write`, `edit`                       | allowed only on the one file of an open grant                                                           |
| `drill_log`                           | allowed (it appends to the learning log)                                                                |
| `codemode`, `tool_search`             | allowed: each call they make comes back through the gate on its own                                     |
| anything else (MCP, other extensions) | blocked unless its author marked it read-only or you list it in `allowTools`                            |

**4. The chat gate** (`src/leak.ts`, run on `message_end`). A fenced code block longer than `maxCodeLines` is replaced with a one-line notice before the reply is stored. The notice stays in the conversation, so on its next turn the model reads that its solution was removed. Blocks labelled `text`, `console`, `log` or `output` are left alone.

## Grants

`/boilerplate <path>` and `/refactor <path>` are slash commands, and a model cannot type a slash command. That is the whole trick: the model can never grant itself anything.

A grant covers one absolute path and lasts until Pi settles after that one request. `/boilerplate` checks the path against the `boilerplate` globs and adds `write` and `edit` back for that run. `/refactor` requires an existing, non-empty file inside the project and adds `edit` only. The shell stays read-only during a grant.

## The learning log

`~/.pi/agent/drill/log.jsonl`, append-only, one record per line: `session`, `concept`, `quiz`, `review`, `leak`, `grant`, `bypass`. Numbers are always computed from it and never stored.

`/quiz` uses a Leitner schedule. A concept comes back 1 day after you learn it, then 3, 7, 14 and 30 days after each correct answer in a row. A wrong answer sends it back to 1 day.

## What drill does not stop

Read this before you trust it.

- **The shell list is an allowlist, not a sandbox.** `npm test` runs whatever your test script runs, and test and lint tools write their own caches and reports (`coverage/`, `target/`, `.pytest_cache/`). The gate stops an eager model from writing code through the shell. It is not built to stop a hostile one.
- **An allowlist can have holes.** Five independent review passes attacked the shell rules while this was built and found 22 ways through: GNU `sed`'s `e` and `w` commands, `uniq in out`, abbreviated long options (`sort --compress-prog`), short forms (`prettier -w`), values glued to flags, `tsc --noEmit false`, brace expansion (`{--write,src.js}`), `# --noEmit` in a comment, `bun test -r`, `go env -u`, and more. Every one is closed and has a regression test, and the design changed twice because of them: options are now allowlisted per command instead of denylisted, and expansions, braces and comments are handled the way the shell handles them. Assume something is still open. For a shell that cannot write at the operating-system level, run Pi in a container with the project mounted read-only, or add Pi's `sandbox` example extension.
- **Your `bashAllow` patterns are the whole rule.** A command they match skips the option checks. Anchor them and keep them narrow.
- **Paths are compared as text.** A symlink inside the project can point a granted path somewhere else. Grants are opened by you, so this is yours to avoid.
- **Short solutions pass.** A six-line answer is under the limit. The limit exists so the mentor can show the shape of an API or quote your line back. Lower `maxCodeLines` if it gets abused.
- **Only fenced code is detected.** Code pasted as plain prose, or spread over several small blocks, is not cut.
- **You may see the code before it is cut.** Pi streams the reply as it is generated; the cut happens when the reply is complete. The stored conversation and the model's own context get the cut version. Not checked: what the terminal shows after the replacement.
- **A grant is honour-based about content.** drill checks which file is written, not what goes in it. `/boilerplate src/types/order.ts` followed by a model that writes a handler into that file is not caught.
- **`--drill-off`, `!command` and your editor are yours.** drill constrains the model, not you.
- **Other extensions are code.** An extension that writes files in its own handlers never passes through the gate.

## Evidence behind the choices

Pi and DeepSeek facts were checked against their own docs and source on 2026-10-13. The study numbers come from the research report produced earlier in this project. Nobody re-opened each paper that day, so follow the links before you quote a number.

| Choice                                                          | Evidence                                                                                                                                                                                                                                                                                                          | Strength                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| The model writes no feature code                                | Shen and Tamkin 2026 ([arXiv 2601.20245](https://arxiv.org/abs/2601.20245)): developers using AI scored 17% lower on a quiz about the library they had just used (n=52, d=0.74). Those who asked conceptual questions and fixed their own errors scored 65-86%; those who delegated scored 24-39%.                | One preprint, small clusters, one task                |
| Hints, not answers                                              | Bastani et al. 2025 ([PNAS](https://www.pnas.org/doi/10.1073/pnas.2422633122)): students with unrestricted GPT-4 did 17% worse once it was removed. A tutor version that withheld answers largely avoided the harm.                                                                                               | Peer-reviewed RCT, high-school maths, not programmers |
| You attempt first                                               | Productive failure and the generation effect: trying before being told improves retention (Kapur; Slamecka and Graf).                                                                                                                                                                                             | Classic findings, cited from memory                   |
| The rule is enforced in code, not only in the prompt            | Li et al. 2024 ([arXiv 2402.10962](https://arxiv.org/abs/2402.10962)): instruction drift within 8 rounds. Laban et al. 2025 ([arXiv 2505.06120](https://arxiv.org/abs/2505.06120)): a 39% average drop in multi-turn settings across 15 models.                                                                   | Neither tested DeepSeek V4.1 Flash                    |
| A reminder every turn, not at 50% of the window                 | Same two papers: drift is measured in turns. With a 1M-token window, 50% is 500K tokens, far too late. Li et al. found that repeating the instructions helps.                                                                                                                                                     | No study tests a specific cadence                     |
| Reminders are appended, the system prompt never changes         | DeepSeek's [context caching](https://api-docs.deepseek.com/guides/kv_cache/) hits only on a matching prefix. Cached input costs $0.006 per 1M tokens at peak against $0.30 uncached ([pricing](https://api-docs.deepseek.com/quick_start/pricing)), a factor of 50.                                               | Official docs, checked 2026-10-13                     |
| Brutal about the code, never about you                          | Kluger and DeNisi 1996: over a third of feedback interventions made performance worse, mostly when feedback pointed at the person. Porath and Erez 2007: rudeness lowered task performance and recall. Finkelstein and Fishbach 2012: experts seek out negative feedback and act on it.                           | Peer-reviewed; a meta-analysis and experiments        |
| The "angry" voice is for tone, the rubric is for accuracy       | Wharton Prompting Science Reports 2025 ([threats and tips](https://gail.wharton.upenn.edu/research-and-insights/techreport-threaten-or-tip/), [expert personas](https://gail.wharton.upenn.edu/research-and-insights/playing-pretend-expert-personas/)): neither threats nor personas reliably improved accuracy. | Preprints, multiple-choice benchmarks                 |
| "Nothing structural" is a legal verdict, and praise is rationed | Sharma et al. 2023 ([arXiv 2310.13548](https://arxiv.org/abs/2310.13548)): assistants tell people what they want to hear. A reviewer told to always find problems will invent them.                                                                                                                               | Preprint from Anthropic                               |
| Quizzes on a spaced schedule, recall not multiple choice        | Dunlosky et al. 2013: of ten study techniques, practice testing and spaced practice were the two rated high utility.                                                                                                                                                                                              | Peer-reviewed review                                  |
| You explain the fix back                                        | Self-explanation (Chi) and the illusion of explanatory depth (Rozenblit and Keil): people believe they understand mechanisms they cannot explain.                                                                                                                                                                 | Classic findings, cited from memory                   |
| Progress is a weekly comparison, not "2^N per day"              | Practice gains follow a curve that flattens. Doubling daily for 30 days is a factor of a billion.                                                                                                                                                                                                                 | Arithmetic                                            |

## What the evidence does not support

- **That an angry reviewer finds more real bugs.** There is no study showing it. Expect the same accuracy with a sharper tone.
- **That a cheap, fast model is a strong reviewer.** The research report found that DeepSeek's own model card shows V4.1 Flash scoring lower inside Pi than inside DeepSeek's harness (66.2 against 72.6 on one coding benchmark). That figure was not re-checked here. For a review that matters, switch to a stronger model with `/model` for that turn.
- **That never reading AI-written code is always right.** In a field where you are a beginner, reading a worked example and then interrogating it works well. The no-code rule fits the stack you already ship in.
- **Anything about ADHD.** Nothing in this design was checked against research on ADHD. The short loops and the external log are reasonable guesses.
