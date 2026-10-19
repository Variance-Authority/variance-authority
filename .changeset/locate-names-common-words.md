---
'@variance-authority/mcp': minor
---

`variance_locate` marks a word most of the searched subjects have, and ranks two words said side by side

A match on a word that more than half the searched subjects have in that field
prints `(in N of M)`, and the answer names such words above the list. When every
word of the question is that common, and so is every pair said side by side, the
headline says that no subject is distinguished and that the order is no answer.

Two adjacent words of the question found adjacent, in that order, in one
recorded value rank a subject above one that has the same words apart; the
value is cut into words as the index cuts it, so `ClearCompleted` says
`clear completed`. The
answer prints each such pair under its hit. `LocateHit` gains `pairs` and
`together`, `LocateMatch` gains `holders` and `common`, and `Located` gains
`searched`, `common` and `distinguished`.
