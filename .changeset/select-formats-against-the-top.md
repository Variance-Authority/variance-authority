---
'@variance-authority/cli': patch
---

`variance select --format vitest` run from a directory inside the checkout
hands vitest the test files the journal names. Each `--exclude=` path is
resolved from the top of the checkout, where the journal's paths start, rather
than from the directory you ran it in, which named files that do not exist and
left the run skipping nothing.
