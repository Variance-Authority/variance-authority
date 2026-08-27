---
'@variance-authority/dom': patch
---

Ask a stylesheet's owner optionally, so a DOM that answers `undefined` instead
of `null` is indexed rather than thrown at. jsdom below 26 leaves `ownerNode`
unset on every sheet it parses, and the stabilization-sheet check dereferenced
it behind a `!== null` guard — so the first page carrying any stylesheet failed
with a TypeError out of a private module instead of returning a snapshot.
