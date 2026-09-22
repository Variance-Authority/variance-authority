---
'@variance-authority/sense': patch
---

Build the native scanner without the tree-sitter grammars when they are what failed

The five grammars are C parsers compiled by whatever toolchain the machine has,
which is a way for the build to fail that the rest of the crate does not have. A
failed build is now retried with them dropped, and says so loudly. Python, Rust,
Java, Kotlin and Swift are then read by the JavaScript readers that are the
implementation of record; nothing else about the scanner changes.
