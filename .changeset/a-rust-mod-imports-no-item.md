---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A Rust `mod` declaration imports no item

`mod order;` was recorded as importing an item named `order` from `order.rs`,
so `ask uses --name order` listed the `mod` line beside each `use` that names
the function. The reader records the file as taken whole,
the way Python's `import m` is, and `uses` lists only the `use` lines. The
source index moves to format version 21, so an index the earlier reader wrote
is read again.
