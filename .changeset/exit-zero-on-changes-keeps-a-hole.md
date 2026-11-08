---
'@variance-authority/cli': patch
---

`variance run` and `variance report` with `--exit-zero-on-changes` still exit 1 when a subject could not be observed, an observation errored, or the report does not say what it skipped, and say so on stderr. Only a change becomes 0. Under GitHub Actions the line saying a change was suppressed is a `::warning::` annotation.
