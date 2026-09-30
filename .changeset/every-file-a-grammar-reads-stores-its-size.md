---
"@variance-authority/sense": minor
---

Python, Rust, Swift, Java and Kotlin files store their size

The source index stores the bytes and the lines of code of every file a tree-sitter grammar reads, as it does for JavaScript and TypeScript. A line of code is a line with something other than a comment or whitespace, and a comment is a node the language's grammar names as one, such as `line_comment` and `block_comment` in Rust. A Python docstring counts as code. A file with a syntax error is still sized, and a comment inside the part the parser could not read counts as code. A file the grammar cannot parse at all has no size. `fileSizes` returns these files without `blocks`, because the instrument does not cut them into regions. The source index format moves to version 15, so an existing index is rebuilt once.
