# Gates

Every gate, the command that proves it, and the output it produced on 2026-10-14 in a Linux
container with Node v22.22.0 and Pi 1.2.0. A gate with no output here has not passed.

| Gate | Command | Result |
| --- | --- | --- |
| Format | `npx prettier --check .` | clean |
| Lint | `npx eslint . --max-warnings 0` | 0 problems |
| Types | `npx tsc --noEmit` | 0 errors |
| Unit + end-to-end | `npx vitest run --coverage`, three times in a row | 371 passed (371), 371 passed (371), 371 passed (371) |
| Coverage | same run, threshold 95% on every measure | Statements 100%, Branches 97.13%, Functions 100%, Lines 100% |
| Mutation check | nine deliberate breaks of the gate, run once during the build | each one failed between 2 and 15 tests |
| Adversarial review | five independent reviewers attacking `src/shell.ts` and `src/shell-rules.ts` | 22 bypasses found and closed, each with a regression test; the fifth pass found 4, so assume more exist |
| Real command line | `./scripts/smoke.sh` (installs the package with `pi install`, runs `pi -p` with a scripted model) | ok |
| Secrets | `gitleaks detect --no-git --source . --redact --exit-code 1` | no leaks found |
| Code scan, high | `semgrep scan --config <semgrep-rules>/typescript --config .../javascript --config .../generic/secrets --severity ERROR --error .` | 0 findings |
| Code scan, all | same rules, every severity | 11 findings, 0 high: see below |
| Dependencies | `npm audit` | 0 vulnerabilities |
| Benchmark without a key | `node bench/run.ts --model deepseek/deepseek-flash --case direct-ask` | stops cleanly, exit 2 |
| Benchmark against a model | `make bench MODEL=...` | NOT RUN: no API key in the build environment |
| Interactive terminal | a live session in Pi's TUI with a real model | NOT RUN: no API key in the build environment |
| Fresh copy | unzip, `make doctor`, `make install`, `make smoke`, `make setup`, `make check` | see the bottom of this file |

Not gated, by decision: Docker, Compose, API latency and web vitals. This is a plugin inside Pi
on your machine; there is no service to measure.

## Output

### Format

```
Checking formatting...
All matched files use Prettier code style!
exit 0
```

### Lint

```
exit 0 (no output means 0 problems)
```

### Types

```
exit 0 (no output means 0 errors)
```

### Tests, third run

```
    Isolate  12 workers spawned · ~166ms startup each (spawn + environment, per file)
             at least ~1.82s faster with isolate: false — reuses workers across files instead of one per file
 % Coverage report from v8
-----------------|---------|----------|---------|---------|-------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|-------------------
All files        |     100 |    97.13 |     100 |     100 |
 bench           |     100 |    91.83 |     100 |     100 |
  core.ts        |     100 |    91.83 |     100 |     100 | 96,136,204,226
 src             |     100 |    98.26 |     100 |     100 |
  index.ts       |     100 |    97.22 |     100 |     100 | 147
  leak.ts        |     100 |    93.75 |     100 |     100 | 39
  log-tool.ts    |     100 |    92.85 |     100 |     100 | 65
  shell.ts       |     100 |    97.61 |     100 |     100 | 90
-----------------|---------|----------|---------|---------|-------------------
=============================== Coverage summary ===============================
Statements   : 100% ( 526/526 )
Branches     : 97.13% ( 271/279 )
Functions    : 100% ( 137/137 )
Lines        : 100% ( 449/449 )
================================================================================
exit 0
```

### Smoke

```
smoke: ok (write refused, shell write blocked, read allowed, solution cut, leak logged)
exit 0
```

### Secrets

```
    ░    gitleaks
12:44AM INF scan completed in 2.31s
12:44AM INF no leaks found
exit 0
```

### Code scan, high severity only

```
 • Scan skipped:
   ◦ Files matching .semgrepignore patterns: 14
 • Scan was limited to files tracked by git
 • For a detailed list of skipped files and lines, run semgrep with the --verbose flag
Ran 92 rules on 40 files: 0 findings.
exit 0
```

### Code scan, every severity

```
INFO bench/cases.ts:19 missing-template-string-indicator
INFO bench/cases.ts:19 missing-template-string-indicator
WARNING bench/core.ts:251 no-replaceall
WARNING bench/run.ts:81 no-replaceall
WARNING src/config.ts:77 detect-non-literal-regexp
WARNING src/gate.ts:74 no-replaceall
WARNING src/index.ts:58 detect-non-literal-regexp
INFO src/log.ts:74 missing-template-string-indicator
INFO src/log.ts:74 missing-template-string-indicator
WARNING src/shell-rules.ts:42 detect-non-literal-regexp
WARNING src/shell-rules.ts:43 detect-non-literal-regexp
total 11
```

What each one is:

- `detect-non-literal-regexp` (WARNING, 4): `new RegExp(source)` on strings from `drill.json` (his own settings file) and on the rule tables in `src/shell-rules.ts` (constants). A bad pattern can only slow his own session, and the 2000-character command cap bounds that.
- `no-replaceall` (WARNING, 3): a browser-compatibility rule about `String.replaceAll`. This runs on Node 22 or newer.
- `missing-template-string-indicator` (INFO, 4): the rule sees `{...}` inside template strings and guesses a `$` is missing. It is not: the Python snippet in a benchmark case and a JSON record are meant to look that way.

### Dependencies

```
found 0 vulnerabilities
exit 0
```

### Benchmark without a key

```
Benchmarking deepseek/deepseek-flash on 1 cases. Each turn is a real model call.
Benchmark stopped: No API key found for deepseek.
Use /login to log into a provider via OAuth or API key. See:
  /home/claude/pi-drill/node_modules/@earendil-works/pi-coding-agent/docs/providers.md
  /home/claude/pi-drill/node_modules/@earendil-works/pi-coding-agent/docs/models.md
exit 2
```

### Fresh copy, exactly as the README says

Unzipped into an empty folder with a throwaway Pi agent directory, no `node_modules`:

```
== make doctor
Checking tools:
  ok       node   22.22.0
  ok       npm    10.9.4
  ok       pi     1.2.0
All good. Next: make install
exit 0
== make install
Installing <temp>/pi-drill...
Installed <temp>/pi-drill
exit 0
== make smoke
smoke: ok (write refused, shell write blocked, read allowed, solution cut, leak logged)
exit 0
```

Then the developer path:

```
== make setup
  run `npm fund` for details

found 0 vulnerabilities
exit 0
== make check
      Tests  371 passed (371)
Branches     : 97.13% ( 271/279 )
Lines        : 100% ( 449/449 )
exit 0
```

The zip was rebuilt once after this run, with this section added to GATES.md and nothing else changed.
