---
'@variance-authority/sense': patch
---

A case index is replaced whole, never written in place

`recordExecution` and the case fold wrote `.cases.bin` over the previous file.
A worker killed during the write left an index the next `--since` could not
decode. The index is now written beside the old one and renamed over it, as the
snapshot already was.
