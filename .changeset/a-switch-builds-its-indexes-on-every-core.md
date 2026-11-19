---
'@variance-authority/sense': patch
---

A branch switch builds the indexes Rust, Java and Kotlin imports resolve
through on every core, and builds each language's at the same time as the
others, with the same answers. On a large Rust and Java checkout the walk of a
switch takes about a third of the time it did. With
`VARIANCE_AUTHORITY_INDEX_STAGES=1` set, the walk's line now ends with
`wall: index`, the time spent building those indexes, which no stage named
before.
