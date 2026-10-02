---
'@variance-authority/cli': minor
'@variance-authority/distill': patch
---

`variance distill` reads the execution index your last recorded run left, the
one `covering` reads, so a run wrapped in `withTestSelection` needs no
`executionFile` and the command needs no `--execution`. `--suite <name>` picks
one declared suite's index. `--execution <path>` still reads any other index,
including JSON from another tool. With nothing recorded, `distill` refuses as
`unrecorded`.
