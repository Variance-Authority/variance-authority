---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
'@variance-authority/cli': minor
---

The Timeline groups test files by worker lane

The Playwright recorder keeps, per test file, the worker lane
(`parallelIndex`) of its earliest attempt, in a new `tests.lane` column
(record format 14). `variance view` draws one row group per lane; a record
with no lane is drawn as before.
