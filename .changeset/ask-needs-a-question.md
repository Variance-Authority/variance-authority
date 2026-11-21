---
'@variance-authority/cli': minor
---

Refuse question arguments without a question

`variance ask --to src/entry.ts` and other questionless argument requests now exit with code `2` and a short diagnostic. Name the question with `variance ask <question> ...`. Bare `variance ask` still lists questions, and explicit help still succeeds.
