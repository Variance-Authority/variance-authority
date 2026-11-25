---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/playwright-test': minor
---

`variance trace` prints a recorded run as OTLP spans

A recorded Playwright run now carries the epoch millisecond each file started
at, and `variance trace --format otlp` renders the run as OpenTelemetry spans —
run, file, phase, case — that any trace viewer opens on the runner's own clock.
A file whose runner gave no start has no span. Records written before this open
with every file unstarted.
