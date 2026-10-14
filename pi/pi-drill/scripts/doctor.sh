#!/bin/sh
# Checks every tool the project needs and says exactly how to fix what's missing.
# Keep the minimum versions in step with STACK.md.
set -u
failed=0

need() { # need <command> <minimum version> <how to install>
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '  missing  %-6s install: %s\n' "$1" "$3"
    failed=1
    return
  fi
  have=$("$1" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  if [ "$(printf '%s\n%s\n' "$2" "$have" | sort -V | head -1)" != "$2" ]; then
    printf '  too old  %-6s have %s, need %s+: %s\n' "$1" "$have" "$2" "$3"
    failed=1
  else
    printf '  ok       %-6s %s\n' "$1" "$have"
  fi
}

echo "Checking tools:"
need node 22.19.0 "https://nodejs.org/ or: fnm install 22"
need npm 10.0.0 "comes with Node"
need pi 1.2.0 "npm install -g @earendil-works/pi-coding-agent"

if [ "$failed" -eq 0 ]; then
  echo "All good. Next: make install"
else
  echo "Fix the lines above, then run make doctor again."
fi
exit "$failed"
