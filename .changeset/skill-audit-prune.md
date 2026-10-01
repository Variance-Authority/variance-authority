---
"@variance-authority/cli": patch
---

The skill states what the commands do now, in fewer words

An audit checked every command, flag, exit code and quoted output in the `variance-authority` skill against the code. The skill now covers `journey-map`, `stack`, `costs` and `variations`, the per-suite answer of `covering`, and the `--suite`, `--since`, `--diff` and `--limit` flags it left out. It corrects what `ask` reads when the configured report is absent, the exit codes of `adjudicate` and of a `symbol` miss, the `--root` flag `variance ask` refuses, the recording path and read order when suites are declared or the checkout is a worktree, and which MCP tools a server serves. `orient`, `journey-map`, `stack` and `slowest-tests` move to their own reference, and the selection API moves out of the test-selection reference, so a name lookup loads about half of what it did. Text that restated what a command already prints is gone.
