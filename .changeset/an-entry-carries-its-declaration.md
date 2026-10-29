---
'@variance-authority/package': minor
---

Every published `Entry` carries `declared`, the name the file at `at` exports it under, so `at` and `declared` together say which declaration an entry publishes: `export { greet as salute } from './greet.js'` publishes `salute` and declares `greet`, beside a `salute` the same file may export too. `Names` holds each declaration as a `Reached`, which adds that name.
