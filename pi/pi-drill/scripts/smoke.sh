#!/bin/sh
# End-to-end check through the real pi command line, with no API key and no network.
# A scripted model tries to write a file three ways. The test passes when none of them work.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() {
  echo "smoke: FAIL: $1"
  exit 1
}

command -v pi >/dev/null 2>&1 || fail "pi is not installed. Run: npm install -g @earendil-works/pi-coding-agent"

mkdir -p "$work/project/src"
echo "smoke project" >"$work/project/README.md"
export PI_CODING_AGENT_DIR="$work/agent"
cd "$work/project"

pi install "$root" >/dev/null
pi -e "$root/test/smoke/scripted-model.ts" --model scripted/bad-mentor --no-session --mode json \
  -p "write the handler" </dev/null >"$work/out.jsonl"

[ ! -e src/handler.ts ] || fail "the model wrote src/handler.ts"
grep -q 'Tool write not found' "$work/out.jsonl" || fail "the write tool was available to the model"
grep -q 'Blocked by drill' "$work/out.jsonl" || fail "the shell write was not blocked"
grep -q 'smoke project' "$work/out.jsonl" || fail "the read-only shell command did not run"
grep -q 'drill removed 10 lines of code' "$work/out.jsonl" || fail "the solution was not cut from the reply"
grep -q '"kind":"leak"' "$work/agent/drill/log.jsonl" || fail "the leak was not logged"

echo "smoke: ok (write refused, shell write blocked, read allowed, solution cut, leak logged)"
