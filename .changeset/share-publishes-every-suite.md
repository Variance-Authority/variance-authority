---
'@variance-authority/cli': minor
---

`variance share` in a repository whose root `variance.config.json` declares suites takes the records a CI run's jobs handed on, files or directories holding `suites/<suite>/coverage.bin`, and lands them over the mainline's record of each suite before it reads or publishes, so a sharded or sliced suite needs no fold of its own. Without `--suite`, it reads or publishes every suite the root config gives `"carry": "share"`, and a publish that could not publish one exits 2 and names each, as `not published: integration.`; under `--format github` each output is keyed by its suite, `commit-<suite>=`. `share --suite <name>` now lays the mainline's record into the checkout, and prints `based=true` when that record keeps its cases. `--collected` takes a directory holding one `<suite>.txt` per suite.
