---
"@variance-authority/cli": minor
---

`variance carry --format github` names the suites given to the share

When the root `variance.config.json` gives any suite `"carry": "share"`, `variance carry restore --format github` and `variance carry save --format github` print `shared-suites=<name> <name>`: those suites, separated by spaces. A workflow loops over it to read, compare and publish each suite's base record, so it names no suite the config already names. A shared suite whose name holds a space is refused, because the loop reading the line would split it.
