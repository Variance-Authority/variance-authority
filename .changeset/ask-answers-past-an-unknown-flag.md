---
'@variance-authority/cli': minor
---

`variance ask` answers past a flag the question does not take, or one no question takes, instead of refusing it. Each is named on standard error with the flags the question takes and the nearest spelling, and the answer exits `0`. A missing required argument, a malformed value and a stray word are still refused, and every other command still refuses an unknown flag.
