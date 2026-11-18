---
'@variance-authority/sense': patch
---

A Python, Rust, Swift, Java or Kotlin file the reader has something to say about is named once in its record's reason, as `<file> — <reason>`, rather than twice. The parse, which every file holding the same bytes shares, now names none of them, so two byte-identical files no longer report each other's path, and indexing the same tree twice writes the same index.
