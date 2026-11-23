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
nothing can observe. A break the test is still running five times past the
unbroken run's time, and at least two seconds, is stopped and named as hung. A
command that fails with nothing broken is refused, and so is a checkout whose
configuration names a `cacheRoot`, which the command's runs would record into.

Each break is cut from the file as the checkout holds it now, under the probes
the recording was made with, and placed at the recording's commit; a region
whose recording names no commit, or whose lines cannot be placed, is left
unbroken with the reason rather than read where its lines stand now. One ask
runs at most twenty breaks and counts the regions it did not try.
`extremeBreaks` is exported from `@variance-authority/sense/test-selection`.
