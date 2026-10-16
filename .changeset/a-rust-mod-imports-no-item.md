---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A Rust `mod` declaration imports no item

`mod order;` was recorded as importing an item named `order` from `order.rs`,
so `ask uses --name order` listed the `mod` line beside each `use` that names
the function. The reader records the file as taken whole,
the way Python's `import m` is, and `uses` lists only the `use` lines. Test
selection reads the file that declares a module as depending on the whole
module file, where it depended only on an item named like the module, so a
change to any item of it selects the tests above. The
source index moves to format version 21, so an index the earlier reader wrote
is refused and rebuilt.
