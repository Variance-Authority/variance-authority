---
'@variance-authority/sense': minor
'@variance-authority/help': patch
'@variance-authority/cli': minor
---

Add `variance proves --file <path> --name <name> -- <command>`: it breaks each
region one recorded test entered in the extreme, fewest other tests first, and
runs the command under each break. A function returns nothing; a branch,
continuation or handler is skipped. Each break is served to the processes the
command starts, so `variance` writes no file of the checkout, and the command
records to a scratch directory, so the record is left as it was; what the
command itself writes in the checkout stays there. The answer names the
regions the test survived broken and the ones it noticed, and says that a
survivor is an assertion that does not read the region or passes on what its
break gives, or a break nothing can observe, such as code its break is
equivalent to. A break the test is still running five times past the unbroken
run's time, and at least two seconds, is stopped, and named as hung when the
run read the broken file; one that read none is named as not broken. A command
that fails with nothing broken is refused, and so is a checkout whose
configuration names a `cacheRoot`, which the command's runs would record into,
and an ask on Windows, where a run stopped at its deadline leaves the processes
it started running.

Each region is matched by the identity its recording gives it, not by its
lines, and cut from the file as the checkout holds it now under the probes the
recording was made with; a region whose source changed since the recording is
left unbroken with the reason. Every run, the one with nothing broken too,
leads its own process group, which is stopped with it: at its deadline, and
killed at an interrupt and at its end. One ask runs at most twenty breaks
and counts the regions it did not try. `extremeBreaks` is exported from
`@variance-authority/sense/test-selection`.
