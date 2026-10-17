---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask uses` now names the kind of each declaration a file keeps to itself, the way `ask symbol` does. A Rust `mod walk;` and the `pub(crate) fn walk` inside it share a spelling and are two declarations. The answer listed the function's imports and then said "`walk` is declared, not exported, at src/lib.rs:1", which read as a second fact about the same function. It now says "`walk` [module] is declared, not exported, at src/lib.rs:1". When a name has several such declarations, each line carries its own kind, so a `function` in one file and a `const` in another are told apart.
