---
'@variance-authority/playwright': patch
---

`variance run` on a machine with no browser installed says the browser did not
start, followed by Playwright's reason, which names the command that installs it.
It no longer calls that a defect in the tool or prints a stack. The exit code
stays `2`. Any launch that fails reads this way, and nothing is checked before
the launch, so a machine whose launch works is never refused.
