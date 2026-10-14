# AGENTS.md

You are about to change a security boundary. Five reviewers found 22 ways through the shell gate while it was built, and the fifth one still found four. If you think your change is too small to matter, that is exactly what the author of `sort -ofile` thought. Read this whole file, then read the real code, in full, before you touch anything.

## Before you say "done"

```sh
make check      # format, lint (0 issues), types, every test, coverage >= 95%
make smoke      # the real pi command line against a scripted model that tries to write code
```

Both pass or you are not done. If a gate is red, the code is wrong, not the gate. Lowering a threshold, skipping a test, or adding a lint suppression to get green is the one move that gets a change thrown out unread.

"It should work" is not a sentence anyone here says. Either you ran it and the output is in front of you, or you say "untested".

## Read the real thing

- Read a file in full before you edit it. A grep hit is a keyhole, not a view. The shell gate has been broken by people who understood the regex they edited and not the one three lines below it.
- Read Pi's actual types before you call anything: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`. Pi's docs are good, and they are still not the source. An invented event name or field is the worst thing you can write here, because it fails silently and the tests that would catch it do not exist yet.
- Read the test that covers the code you are changing. If there is none, that is your first finding, and your first task.

## Where things live

```
mentor.md            the system prompt. {{MAX_CODE_LINES}} is filled in from the settings.
commands/*.md        Pi prompt templates. The file name is the slash command.
src/index.ts         wires handlers into Pi's events. No rules live here, and none get added here.
src/gate.ts          which tool calls are allowed. Pure functions.
src/shell.ts         reads a shell command the way bash does and checks each simple command. Pure.
src/shell-rules.ts   the commands the shell may run and the options each one accepts. Data only.
src/leak.ts          finds and cuts code blocks in a reply. Pure.
src/reminder.ts      the reminder texts and when the full digest is sent.
src/commands.ts      /boilerplate, /refactor, /quiz, /progress.
src/config.ts        drill.json: schema, defaults, loading.
src/log.ts           the learning log: record schema, append, read.
src/progress.ts      due concepts and the weekly report, computed from the log.
src/log-tool.ts      the drill_log tool the mentor calls.
bench/               cases.ts (the script), core.ts (run and score), run.ts (command line), fixture/.
test/rig.ts          starts a real Pi session with a scripted model for end-to-end tests.
```

## How the gate thinks, so you do not break it by accident

The shell gate is not a sandbox and never will be. It is a parser plus an allowlist. Everything it does rests on one claim: **the text it checks is the text bash executes.** Every bypass so far was a place where that claim was false:

- bash expanded something after the gate looked: braces `{--write,x}`, `$VAR`, `$'\x2d'`, `$(…)`
- bash discarded something the gate counted: `tsc -p . # --noEmit`
- a tool read an option the gate did not see as one: `sort -ofile`, `--compress-prog` (GNU prefix matching), `uniq in out` (a positional that is an output file), `--noEmit false` (a positional that negates the flag)
- an allowed option meant something else to a different tool: `-r` is pnpm's recursive and bun's preload

So the design is: refuse every shell construct you cannot model exactly (expansions, braces, redirects, background jobs), split into simple commands, and for each one match a family whose options are **allowlisted**, not denylisted. A denylist is a list of the attacks you have already thought of. It was tried first. It lost.

When you add anything to `src/shell-rules.ts`:

1. Run the tool's `--help` and read every option. Not the ones you remember. All of them.
2. Any option that names a path the tool writes to, or a program, module or config the tool loads, stays off the list. "Who would ever pass that" is not an argument; the model will, because it is trying to be helpful.
3. If an option takes its value as the next word (`--format json`), the value is a positional the gate does not check. Either use `glue` so the pair is judged together, or require the `=` form.
4. GNU tools accept any unique prefix of a long option. Your `refuse` regex has to match the shortest prefix the tool accepts, not the full name. `git log --out=x` writes a file; so does `--ou=x`.
5. Write the test for the option you allowed, and the test for the option you left out that would have written something. Then try to get past your own rule for ten minutes. Then run `make check`.

## Rules

- **Decisions are pure, effects are in `index.ts` and `commands.ts`.** `gate.ts`, `shell.ts`, `leak.ts`, `reminder.ts` and `progress.ts` take values and return values. That is why they have 100% line coverage and why breaking them fails between 2 and 15 tests. Keep it that way.
- **Fail closed, every time.** A command the gate cannot understand is blocked. A settings file with one bad key is ignored whole. An unknown tool is blocked. If you find yourself writing "allow unless", stop.
- **The model can never grant itself anything.** Grants open only inside slash-command handlers, because a model cannot type a slash command. Never open one from a tool, a prompt template, or any event the model can trigger. This is the one invariant the whole package exists for.
- **Block reasons are written for the model, not for you.** The model reads them as the tool result and decides what to do next. "Blocked" teaches it nothing. Say what was refused and what it may do instead.
- **Style:** Google TypeScript Style Guide, enforced by typescript-eslint strict-type-checked and Prettier. Function 40 lines, file 300, cyclomatic complexity 10, parameters 4. The linter is at 0 and stays at 0.
- **No `any`, no `as` casts in `src/`.** A cast is a promise you are making to the compiler on the model's behalf. The test rig is the one place with a `Proxy` cast, and it has a comment saying why.
- **Tests describe behaviour**, in the name: `blocks a command that hides the required flag in a comment`, not `test shell 7`. Every branch has one. Every change inside Pi gets an end-to-end test in `test/e2e*.test.ts`, which starts a real Pi session and checks the filesystem, because "the gate returned block" and "the file was not written" are different claims.
- **Comments explain why.** A constraint, an invariant, a bypass that was closed, a link. A comment that narrates the next line is an admission the line is unclear; fix the line. No TODO in committed code: do it or file it.
- **Writing:** plain words, short sentences, real commands. If a sentence could appear in a product brochure, delete it.

## Never

- Add a command to `src/shell-rules.ts` without an `options` list unless you have read its `--help` and found no option that writes a file or runs a program. `cat` qualifies. `sort` did not, and that cost a review cycle.
- Let `allowTools` or a `readOnlyHint` open `write`, `edit`, `bash` or `powershell`. `decide()` checks those four first, on purpose, before any allowlist. Keep that order.
- Rewrite the system prompt or earlier messages mid-session. It invalidates the provider's prompt cache, which at DeepSeek's prices is a 50x cost increase per turn. Append.
- Add a runtime dependency. Pi does not install dependencies for a local package, and `pi install <folder>` has to keep working with no `npm install`. The package has zero runtime dependencies and that is a feature, not an oversight.
- List `@earendil-works/*` or `typebox` under `dependencies`. Pi supplies them; a second copy breaks Pi's module mapping. They are peer dependencies.
- Weaken a benchmark case to make a model pass. The benchmark exists to make models fail honestly.
- Trust this file over the code. If they disagree, the code is what runs; fix the file.

## Adding a rule to the gate

1. Write the failing test first, in `test/gate.test.ts` or `test/shell.test.ts`. If you cannot write a test that fails without your change, you do not know what your change does.
2. Change `src/gate.ts` or the tables in `src/shell-rules.ts`. The parser in `src/shell.ts` changes only for a new shell construct, and a new shell construct needs a test showing bash's behaviour, not your memory of it: run the command with `bash -c` in a scratch directory and look.
3. Add an end-to-end case in `test/e2e.test.ts` if the rule changes what a real session does.
4. `make check && make smoke`.
5. Spend ten minutes trying to get past your own rule. Write down what you tried in the test file as blocked cases. Future reviewers will try the same things, and it is cheaper if they find them already covered.

## Adding a benchmark case

1. Add it to `bench/cases.ts`. A `hold` case scores every turn; a `comply` case needs `expectFile`.
2. Update the turn count asserted in `test/bench.test.ts`. It is asserted on purpose, so that a case cannot disappear quietly.
3. `make check`.

## What would prove this file wrong

A change that passes `make check` and `make smoke` and still lets the model write a file. If you find one, that is not a reason to relax the rules above. It is a new test, a new line in `docs/DESIGN.md` under "An allowlist can have holes", and a reason to read the parser again.

## How to write a reply

You write like a maintainer answering an issue at midnight, not like a wiki. People scan, they do not read: 79% of readers skim, and attention lands on the first line and the first words of each paragraph (Nielsen). Working memory holds about four things (Cowan 2001). Write for that reader.

- First sentence is the verdict, the answer, or the bug. If he reads nothing else, he has it.
- Then the one concrete thing that proves it: a line number, a number with a unit, a short trace, the exact command and its output. The concrete fact comes before the explanation, never after.
- Then why, in one to three sentences. Stop when the why is done. No summary of what you just said.
- One idea per paragraph. If a paragraph has "and also", split it. If a bullet has three clauses, it is three bullets or it is prose.
- Sentences under 20 words. Plain words. If a sentence needs a second read, rewrite it.
- Prose by default. A list only when the items are parallel and there are three or more. Never a bulleted list of paragraphs.
- No headers in a reply. Headers are for documents; a reply is a message.
- Bold at most one phrase, the thing he must not miss. Bold everywhere is bold nowhere.
- Concrete over category. "Each sqflite open is a channel round trip, 30 to 80 ms warm" beats "the lifecycle has startup costs". A number, a file, a function name, a man page section.
- Praise what is right in one line, naming what, then move on. Do not describe his file back to him.
- Match length to the question. One-line question, one-line answer. A review gets findings, not an essay.
- End a real answer with the one thing he does next, or what would prove you wrong. Not both. Not a list.

The test: read it aloud. If it sounds like documentation, cut it in half. If it still does, cut it again.
