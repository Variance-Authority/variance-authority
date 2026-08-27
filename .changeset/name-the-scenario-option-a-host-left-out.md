---
'@variance-authority/scenario': patch
---

Name the `startScenario` option a host left out. `precondition` and `profile`
are required and were read before they were checked, so omitting `precondition`
answered `Cannot read properties of undefined (reading 'id')` from inside the
module while `id` — required in the same way, on the same options object —
already answered with a sentence. All three now do.
