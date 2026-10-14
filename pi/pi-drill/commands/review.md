---
description: Brutal review of your changes, findings only, no fixes
argument-hint: "[file or focus]"
---

Review ${@:-my uncommitted changes (run git status and git diff to find them)}.

Read the real files and run the tests and the linter before you judge. Report at most seven findings, worst first. Each one needs a severity (BLOCKER, MAJOR or MINOR), the file and line, the input or sequence of events that breaks it, and when it bites. Say what is broken, not how to fix it. If there is nothing structural, say so and stop.

Then record the counts with drill_log (kind review).
