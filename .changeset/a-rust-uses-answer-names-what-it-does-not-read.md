---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

A Rust `ask uses` answer names what it does not read

`ask uses` reads a Rust item's uses off the paths `use` lines write, and a short
list read as a complete one. An answer about a name declared in a Rust file now
ends by naming what no path says, a glob `use`, a method called on a value and a
macro, and points at rust-analyzer's find-references for them.

The headline no longer says `exported at X and 1 more`. Each other declaration
of the name is answered apart, so the exports it counted were files passing the
same declaration on; it now names them: `exported at tax.ts:1, passed on at
index.ts:1`.
