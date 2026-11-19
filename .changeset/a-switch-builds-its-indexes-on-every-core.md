---
'@variance-authority/sense': patch
---

A branch switch builds the indexes imports resolve through — the Rust module
tree and crates, the Java and Kotlin source roots, and the Python and Swift
indexes — at the same time, and the Rust and JVM ones on every core, with the
same answers. On a large Rust and Java checkout the walk of a switch takes
about 40% of the time it did. With `VARIANCE_AUTHORITY_INDEX_STAGES=1` set,
the walk's line now ends with `wall: index`, the time spent building those
indexes, which no stage named before.
