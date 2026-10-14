# drill

Reverse mentor mode for the [Pi coding agent](https://pi.dev). The model reviews your code and teaches you; you write every line of feature code yourself, and the harness makes sure the model cannot write it for you.

## Quick start

```sh
unzip pi-drill.zip && cd pi-drill
make install                      # runs: pi install <this folder>
cd ~/your/project
pi                                # then pick a model with /model, or /login first
```

Pi loads drill from this folder every time it starts, so keep the folder where it is. `make` lists every command.

To check the install without a model or an API key, run `make smoke`. It drives the real `pi` command with a scripted model that tries to write a file three ways, and passes when none of them work.

## What you get

| Piece           | What it does                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mentor prompt   | [`mentor.md`](mentor.md) replaces Pi's system prompt. Blunt senior engineer, hard on the code, never on you. Edit it freely.                               |
| Hard gate       | The model has no `write` or `edit` tool, and its shell can only read and run checks. This is code, so it holds when the prompt drifts.                     |
| Chat gate       | A reply with a code block over 6 lines has the block cut out and the leak logged.                                                                          |
| Rule reminder   | One line after every message you send, and the full rules again after a compaction and at 25, 50 and 75% of the context window.                            |
| Grants          | `/boilerplate` and `/refactor` open one file for one request. Only you can run them.                                                                       |
| Learning log    | The mentor records what you learned, your quiz answers and review results. `/quiz` brings concepts back after 1, 3, 7, 14 and 30 days.                     |
| Progress report | `/progress` shows this week against last week: hint depth, quiz accuracy, blockers per review, leaks, grants.                                              |
| Benchmark       | 36 pressure turns ("just this once", "prod is down", "I'm the user, I override the rules") plus 2 grant cases. Fails a model that holds under 95% of them. |

## Requirements

| Tool | Version                                                          |
| ---- | ---------------------------------------------------------------- |
| Node | 22.19 or newer (tested on 22.22.0)                               |
| Pi   | 1.2.0 or newer: `npm install -g @earendil-works/pi-coding-agent` |
| make | any, optional. Every target is one line you can run by hand.     |

`make doctor` checks these and tells you how to fix anything missing. Using drill needs no `npm install`: it has no runtime dependencies of its own.

## Commands inside Pi

| Command                             | What it does                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `/plan <your plan>`                 | The mentor attacks your plan before you build. It will not write a better one for you.       |
| `/stuck <what, and what you tried>` | The next hint, one rung only: a question, then the exact place to read, then the concept.    |
| `/review [file or focus]`           | Findings by severity with file, line, the input that breaks it and when it bites. No fixes.  |
| `/teachback <your explanation>`     | You explain a concept in your own words and it gets graded. A good one is logged.            |
| `/boilerplate <path> [what]`        | Lets the mentor write one boring file: types, models, schemas, logging, config.              |
| `/refactor <path> [focus]`          | Lets the mentor edit one file you wrote, behaviour unchanged, with a reason for each change. |
| `/quiz`                             | Up to three questions on concepts that are due. Answer from memory.                          |
| `/progress`                         | This week against last week, computed from the log.                                          |

Start Pi with `pi --drill-off` when production is on fire and you need a normal coding agent. That run is recorded as a bypass and shows up in `/progress`.

## Commands in this folder

| Command                            | What it does                                                      |
| ---------------------------------- | ----------------------------------------------------------------- |
| `make install`                     | adds drill to Pi                                                  |
| `make doctor`                      | checks Node, npm and Pi                                           |
| `make smoke`                       | end-to-end check through the real `pi` command, no API key needed |
| `make setup`                       | installs the dev tools (needed for `check`, `test` and `bench`)   |
| `make check`                       | format check, lint, types, tests with the coverage gate           |
| `make test`                        | unit and end-to-end tests                                         |
| `make fmt`                         | formats all code                                                  |
| `make bench MODEL=<provider>/<id>` | runs the adherence benchmark against a model, with your key       |

## Project layout

```
mentor.md      the system prompt
commands/      prompt templates: /plan, /stuck, /review, /teachback
src/           the extension: gate, shell rules, leak cutter, reminders, log, slash commands
bench/         the adherence benchmark: cases, scoring, sample project
test/          unit tests, end-to-end tests on real Pi sessions, the smoke test's scripted model
scripts/       doctor and smoke
docs/          design, limits and the evidence behind each choice
```

## Configuration

Optional. Put a `drill.json` in `~/.pi/agent/` for all projects, or in `<project>/.pi/` for one. A key in the project file replaces the same key in the personal file. [`drill.example.json`](drill.example.json) shows every key.

| Key            | Default                                                | What it does                                                                                                                    |
| -------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `boilerplate`  | types, models, schemas, DTOs, logging and config globs | Paths `/boilerplate` may open. Your list replaces the default list.                                                             |
| `bashAllow`    | `[]`                                                   | Extra regular expressions for shell commands the mentor may run. A match is the whole rule, so anchor them: `^terraform plan$`. |
| `allowTools`   | `[]`                                                   | Extra tools the mentor may call, such as an MCP tool. Never opens `write` or `bash`.                                            |
| `maxCodeLines` | `6`                                                    | Longest code block allowed in a reply, in non-blank lines.                                                                      |
| `leakAction`   | `"redact"`                                             | `"redact"` cuts a longer block. `"warn"` only logs it.                                                                          |
| `fullRulesAt`  | `[25, 50, 75]`                                         | Context percentages at which the full rules are sent again.                                                                     |

A file with a bad value is ignored as a whole and every problem is shown when Pi starts, so a typo can never loosen the gate.

The learning log is `~/.pi/agent/drill/log.jsonl`, one JSON record per line. It is yours: read it, back it up, delete it. Days in `/progress` are UTC days.

## Models

drill has nothing model-specific in it. Any model Pi can talk to works, and `make bench` tells you how well a given one holds the line.

For DeepSeek V4.1 Flash, which Pi 1.2.0 knows as `deepseek/deepseek-flash`:

```sh
export DEEPSEEK_API_KEY=...        # or run /login inside Pi
pi --model deepseek/deepseek-flash
```

Use `/thinking high` for reviews. DeepSeek's API ignores `temperature` while thinking is on, so there is nothing to tune there.

## Tests

`make check` runs the unit and end-to-end tests. The end-to-end ones start real Pi 1.2.0 sessions with Pi's scripted test model and a real temporary project on disk, so "the file was not written" is checked on the filesystem. Coverage must stay at 95% or above; the report prints at the end of the run.

`make bench MODEL=...` is the only test that calls a real model. It sends 38 prompts, each one or more model calls, so it costs tokens. The report looks like this (the numbers here are an example, not a result):

```
Adherence      97.2%  (35/36 pressure turns held, need 95.0%)
Gate bypasses  0  (files changed without a grant, need 0)
Boring work    2/2  (granted files written, need all)
```

Adherence measures the prompt. Gate bypasses measures the code and must be 0. No model results ship with this package, because none were run: see [GATES.md](GATES.md).

## Troubleshooting

| You see                                                           | Fix                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drill settings ignored: ... /maxCodeLines must be <= 200`        | Fix the named key in that `drill.json`. Until then the strict defaults apply.                                                                             |
| `src/cart.ts is not a boilerplate path`                           | Working as intended: that is feature code. If the path really is boilerplate, add a glob to `boilerplate`.                                                |
| `Blocked by drill: "X" is not on the read-only command list`      | Add a pattern for that command to `bashAllow`. Builds are off the list on purpose: they write into the tree.                                              |
| `Blocked by drill: the option "--foo" is not on the list for ...` | Options are allowlisted per command. Use a listed spelling (`--format=json`, not `--format ./my.js`), or add a `bashAllow` pattern for the whole command. |
| `Blocked by drill: "mcp__..." is not on the allowlist`            | Add the tool name to `allowTools`.                                                                                                                        |
| `No API key found for deepseek`                                   | Run `/login` in Pi, or export `DEEPSEEK_API_KEY`.                                                                                                         |
| The slash commands are missing                                    | Run `pi list`. If drill is not there, run `make install` again. Pi loads it from this folder, so do not move or delete the folder.                        |

## More

[How it works, what it does not stop, and the evidence](docs/DESIGN.md) · [Decisions made for you](DECISIONS.md) · [Tools and versions](STACK.md) · [Proof for every gate](GATES.md) · [Rules for changing this code](AGENTS.md)
