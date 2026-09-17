---
'@variance-authority/cli': minor
---

`accept` refuses without a run, and `--help` tells you what each exit code means

Two ways the CLI left you to guess.

**`variance accept` before any run crashed.** There was no report to promote from,
and the failure surfaced as an uncaught exception — a stack trace, from a
situation that is ordinary the first time anyone uses the tool. It now exits `2`
and names the path it looked for, the config key that decides that path, and the
one dead end worth calling out: a `playwright-test` project records through the
runner and has no report here to accept.

**`variance <command> --help` printed the global usage.** The per-command block
existed and the flag was rejected before anything could reach it. Each command now
answers with its own synopsis and flags, and with the exit codes *that command*
can actually return. Only `run`, `report` and `adjudicate` can exit `1`, because
only those three reach the review path; every other command exits `0` or `2`, and
saying so uniformly would have been wrong for twelve of the fifteen.

The three codes keep their meanings: `0` nothing needs review, `1` the run
happened and found something a person must decide, `2` the run did not happen as
configured.
