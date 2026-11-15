---
'@variance-authority/help': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

An answer told nothing changed writes no byte of the generation

`variance ask --changed-file` with an empty file rewrote the whole published
store to move one time in its head: about 85 MB on Kibana, on every such
question. It now leaves the store as it is and moves only the time of a
zero-byte stamp beside the index, and every reader dates the generation by the
later of the two. The answer and the ones after it are dated from that
comparison, as before. `restampHelpStore` is gone from
`@variance-authority/sense`: nothing writes into a published store's head any
more.
