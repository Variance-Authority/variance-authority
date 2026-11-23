---
'@variance-authority/sense': minor
'@variance-authority/help': patch
'@variance-authority/cli': minor
---

Add `variance proves --file <path> --name <name> -- <command>`: it breaks each
region one recorded test entered in the extreme, fewest other tests first, and
runs the command under each break. A function returns nothing; a branch,
continuation or handler is skipped. Each break is served to the processes the
command starts, so the checkout is never written, and the command records to a
scratch directory, so the record is left as it was. The answer names the
regions the test survived broken and the ones it noticed, and says that a
survivor is either an assertion that does not read the region or a break
nothing can observe. A command that fails with nothing broken is refused.

`serveBase` takes the environment and the standard streams of the command it
starts, and `extremeBreaks` and `extremeBreak` are exported beside it.
