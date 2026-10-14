/**
 * The commands the mentor's shell may run, and the options each one may be given.
 *
 * Options are allowlisted, not denylisted. Two review passes on an earlier denylist found
 * thirteen ways through it: abbreviated GNU long options (`--compress-prog`), short forms
 * (`prettier -w`), values glued to a flag (`sort -ofile`), and options nobody had thought of
 * (`tsc --init`, `go test -coverprofile`). A list of what is allowed fails closed on all of
 * those. A command only goes without an option list when none of its options can write a
 * file or run a program.
 */

export interface Family {
  /** Matches the start of a simple command. A pattern ending in `$` describes the whole command. */
  head: RegExp;
  /** The options the command may be given. Left out when no option of the command writes or executes. */
  options?: RegExp;
  /**
   * Options whose value arrives as the next word, such as `--format json`. Group 1 is the
   * option. The checker joins the pair with `=` so `options` judges the value too.
   */
  glue?: RegExp;
  /** Refused even when every option passes. */
  refuse?: RegExp;
}

/** Ways to start a tool that lives in the project's own node_modules. */
const BIN = "(?:npx (?:--no-install )?|pnpm exec |yarn (?:run )?|bunx )?";

/** Script names that check code. `build` is left out because a build writes its output into the tree. */
const SCRIPT = "(?:test|lint|check|types|typecheck)[\\w:-]*";

const GIT = "git (?:--no-pager )?";

const GIT_READ = [
  "status|log|diff|show|blame|ls-files|ls-tree|grep|rev-parse|rev-list|describe|shortlog",
  "cat-file|reflog|merge-base|config --get|stash (?:list|show)",
].join("|");

/** Options that name a reporter or formatter. Named by path, that is a module the tool imports and runs. */
const NAMED_OUTPUT = / (--(?:reporter|format|output-format)) (?=[^-\s])/g;

const head = (source: string): RegExp => new RegExp(`^${source}(?=\\s|$)`);
const exact = (source: string): RegExp => new RegExp(`^${source}$`);
const options = (...alternatives: string[]): RegExp => new RegExp(`^(?:${alternatives.join("|")})$`);

// `--reporter=\w+` accepts a built-in or installed reporter by name, and nothing with a path in it.
const VITEST = [
  "--run|--coverage|--silent|--passWithNoTests|--no-color|--no-watch|--watch=false|--changed",
  "--bail(?:=\\d+)?|--retry=\\d+|--reporter=\\w+|-t|--testNamePattern(?:=.*)?|--no-file-parallelism",
];
const JEST = [
  "--runInBand|-i|--ci|--verbose|--bail|--colors|--detectOpenHandles|--forceExit|--watchAll=false",
  "--maxWorkers=\\S+|--testPathPatterns?(?:=.*)?",
];
const PACKAGE_MANAGER = [
  "-s|--if-present|--workspaces|-ws|--workspace=\\S+|--json|--depth(?:=\\d+)?|--all|-a|--omit=\\w+",
  // `-r` and `--filter` are left out: to pnpm they select packages, to bun and jest they name a
  // module to load and run.
  "--long|-l|--audit-level=\\w+|--production|--recursive",
];

const SORT_FLAGS = "bdfgiMhnRrVcCmsuz";

const FIND_TESTS = [
  "name|iname|path|ipath|wholename|iwholename|regex|iregex|type|xtype|maxdepth|mindepth|newer",
  "mtime|mmin|atime|ctime|size|user|group|perm|empty|not|o|a|or|and|print|print0|printf|prune|quit",
  "depth|xdev|mount|follow|true|false|L|H|P|E|readable|writable|executable|links|samefile|daystart",
].join("|");

// The go tool accepts every flag with one dash or two.
const GO = [
  "v|race|short|cover|failfast|benchmem|json|m|deps|test|u|versions|e|all|src|cmd|count=\\d+",
  "run(?:=\\S+)?|bench(?:=\\S+)?|skip(?:=\\S+)?|timeout(?:=\\S+)?|parallel=\\d+|p=\\d+|tags(?:=\\S+)?",
  "shuffle=\\w+|cpu=[\\d,]+|vet=\\w+|list(?:=\\S+)?|covermode=\\w+|coverpkg=\\S+|f(?:=\\S+)?",
].join("|");

const CARGO = [
  "--all|--workspace|--all-targets|--all-features|--no-default-features|--features(?:=\\S+)?|-F",
  "-p|--package(?:=\\S+)?|--lib|--bins|--bin(?:=\\S+)?|--tests|--test(?:=\\S+)?|--examples|--release",
  "-r|--locked|--offline|--frozen|-q|--quiet|-v|-vv|--verbose|--no-fail-fast|--color=\\w+",
  "--message-format=[\\w-]+|-j\\d*|--jobs(?:=\\d+)?|--no-deps|--document-private-items",
  "--depth(?:=\\d+)?|-e|--edges(?:=\\S+)?|-i|--invert(?:=\\S+)?|--exclude(?:=\\S+)?|-[DWAF]",
  "--nocapture|--test-threads(?:=\\d+)?|--ignored|--include-ignored|--exact|--show-output",
  "--skip(?:=\\S+)?|--check",
];

const PYTEST = [
  "-[xqvsl]+|-k|-m|-r\\w*|-n\\d*|--lf|--ff|--last-failed|--failed-first|--tb=\\w+",
  "--maxfail(?:=\\d+)?|--co|--collect-only|--durations(?:=\\d+)?|--no-header|--disable-warnings",
  "--strict-markers|--runxfail|--showlocals|--color=\\w+|--cov(?:=\\S+)?|--no-cov|--exitfirst",
  "--cov-report=term(?:-missing)?(?::skip-covered)?|--quiet|--verbose|--capture=\\w+",
  "--deselect(?:=\\S+)?|--ignore(?:=\\S+)?",
];

const MYPY = [
  "--strict|--ignore-missing-imports|--show-error-codes|--show-column-numbers|--pretty",
  "--no-color-output|--no-error-summary|--warn-unused-ignores|--disallow-untyped-defs",
  "--check-untyped-defs|--follow-imports=\\w+|--python-version(?:=\\S+)?|--explicit-package-bases",
  "--namespace-packages|-p|-m|--no-incremental|--show-traceback",
];

const RUFF = [
  "--select(?:=\\S+)?|--ignore(?:=\\S+)?|--extend-select(?:=\\S+)?|--extend-ignore(?:=\\S+)?",
  "--output-format=[\\w-]+|--statistics|--no-cache|--preview|--no-preview|--no-fix|--diff",
  "--show-fixes|--line-length(?:=\\d+)?|--target-version(?:=\\w+)?|-q|--quiet|-v|--verbose",
  "--exit-zero|-n",
];

/** Tried in order. The first family whose head matches decides the command. */
export const FAMILIES: readonly Family[] = [
  // Plain readers: nothing they accept can write a file or start a program.
  {
    head: head(
      "(?:cat|head|tail|wc|cut|tr|diff|ls|pwd|which|echo|stat|du|basename|dirname|realpath|jq|grep)",
    ),
  },
  { head: head("rg"), refuse: /\s--(?:pre|hostname-bin)(?=[=\s]|$)/ },
  {
    head: head("sort"),
    options: options(
      `-[${SORT_FLAGS}]+`,
      `-[${SORT_FLAGS}]*[kt]\\S*`,
      "--(?:key|field-separator)=\\S+",
      "--(?:numeric-sort|reverse|unique|human-numeric-sort|version-sort|ignore-case|stable|check)",
    ),
  },
  { head: head("find"), options: options(`-(?:${FIND_TESTS})`, "-\\d+\\w*") },
  // One input file at most: a second file name would be uniq's output file.
  {
    head: exact(
      "uniq(?: (?:-[cdDuiz]+|-[fsw] ?\\d+|--(?:count|repeated|unique|ignore-case|skip-fields=\\d+)))*(?: [^-\\s]\\S*)?",
    ),
  },
  // Fetch only. No output file, no upload, no request body, no config file: the only
  // positional is the address, and curl's output goes to the tool result.
  { head: exact("curl(?: (?:-[sSLfI]+|--max-time=\\d+|--compressed))* https?://[^\\s'\"]+") },
  // A section and a page name only: man's options can name a pager program.
  { head: exact("man(?: \\d\\w*)? [\\w.:+-]+") },
  // Display forms only: a bare timestamp argument sets the clock.
  { head: exact("date(?: (?:-u|-R|-I\\w*|--utc|--iso-8601(?:=\\w+)?|--rfc-3339=\\w+|\\+\\S+))*") },
  // Git accepts any unique prefix of a long option, so every spelling of --output and
  // --open-files-in-pager goes, down to the shortest ones git still resolves.
  {
    head: head(`${GIT}(?:${GIT_READ})`),
    refuse: /\s(?:--o[up]|-O)|\breflog (?:expire|delete|drop)\b/,
  },
  { head: exact(`${GIT}branch(?: (?:-a|-r|-v|-vv|--all|--remotes|--list|--show-current))*`) },
  { head: exact(`${GIT}tag(?: (?:-l|--list)(?: \\S+)?)?`) },
  { head: exact(`${GIT}remote(?: (?:-v|show(?: \\S+)?|get-url \\S+))?`) },
  {
    head: head(`npm (?:test|t|ls|list|view|outdated|audit|run ${SCRIPT})`),
    options: options(...PACKAGE_MANAGER, ...VITEST, ...JEST),
    glue: NAMED_OUTPUT,
    refuse: /^npm audit [^-]/,
  },
  {
    head: head(`(?:pnpm|yarn|bun) (?:run )?${SCRIPT}`),
    options: options(...PACKAGE_MANAGER, ...VITEST, ...JEST),
    glue: NAMED_OUTPUT,
  },
  // Without --noEmit the compiler writes JavaScript next to the sources.
  {
    head: new RegExp(`^${BIN}tsc(?=\\s(?:.*\\s)?--noEmit(?:\\s|$))`),
    options: options(
      "--noEmit|-p|--project|--pretty|--skipLibCheck|--strict|--noErrorTruncation|--diagnostics",
      "--extendedDiagnostics|--listFiles|--explainFiles|--noUnusedLocals|--noUnusedParameters",
    ),
    // `@file` makes the compiler read more options from that file, and a bare `false` after a
    // flag switches that flag off: `--noEmit false` emits.
    refuse: / @|\s(?:true|false)(?=\s|$)/i,
  },
  { head: head(`${BIN}vitest`), options: options(...VITEST), glue: NAMED_OUTPUT, refuse: /vitest init\b/ },
  { head: head(`${BIN}jest`), options: options(...JEST, ...VITEST), glue: NAMED_OUTPUT },
  {
    head: head(`${BIN}eslint`),
    options: options(
      "--ext(?:=\\S+)?|--max-warnings(?:=\\d+)?|--quiet|--format=\\w+|--color|--no-color",
      "--no-error-on-unmatched-pattern|--report-unused-disable-directives|--no-warn-ignored",
    ),
    glue: NAMED_OUTPUT,
  },
  {
    head: head(`${BIN}prettier`),
    options: options("--check|-c|-l|--list-different|--no-color|--log-level=\\w+|--ignore-unknown|-u"),
  },
  {
    head: head(`${BIN}biome (?:check|lint|ci)`),
    options: options(
      "--max-diagnostics=\\w+|--diagnostic-level=\\w+|--reporter=\\w+|--colors=\\w+|--verbose",
      "--error-on-warnings|--changed|--staged|--since=\\S+|--no-errors-on-unmatched",
    ),
  },
  // `go env -w` and `-u` rewrite the user's Go environment file.
  {
    head: head("go (?:test|vet|list|doc|version|env)"),
    options: options(`--?(?:${GO})`),
    refuse: /^go env\b.*\s--?[uw]\b/,
  },
  { head: head("gofmt"), options: options("-[ldse]+") },
  {
    head: head("golangci-lint run"),
    options: options(
      "-v|--verbose|--new|--fast|--tests(?:=\\w+)?|--timeout(?:=\\S+)?|--new-from-rev(?:=\\S+)?",
      "--enable(?:=[\\w,-]+)?|--disable(?:=[\\w,-]+)?|-E|-D|--sort-results",
    ),
  },
  { head: head("staticcheck"), options: options("-f(?:=\\w+)?|-checks(?:=\\S+)?|-tags(?:=\\S+)?") },
  { head: head("cargo (?:test|check|clippy|doc|tree|bench|fmt --check)"), options: options(...CARGO) },
  { head: head("(?:pytest|python3? -m pytest)"), options: options(...PYTEST) },
  { head: head("(?:mypy|python3? -m mypy)"), options: options(...MYPY) },
  {
    head: head("pyright"),
    options: options("-p|--project|--outputjson|--stats|--verbose|--warnings|--level|--pythonversion"),
  },
  { head: head("ruff check"), options: options(...RUFF), glue: NAMED_OUTPUT },
  // Targets only: a variable or --eval on the command line can carry a command.
  { head: exact(`make(?: ${SCRIPT})+`) },
  {
    head: head("docker (?:ps|images|logs|compose (?:ps|logs|config))"),
    options: options(
      "-a|--all|-q|--quiet|--no-trunc|--format(?:=\\S+)?|--tail(?:=\\w+)?|-n|--since(?:=\\S+)?",
      "--until(?:=\\S+)?|-t|--timestamps|--services|--filter(?:=\\S+)?",
    ),
  },
  { head: exact("(?:node|python3?|go|cargo|rustc|npm|pnpm|yarn|bun|git) (?:--version|-v|-V|version)") },
];
