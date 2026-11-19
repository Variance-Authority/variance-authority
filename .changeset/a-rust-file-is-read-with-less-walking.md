---
'@variance-authority/sense': patch
---

A Rust file is read with less work per node: the reader looks a node's kind up by its id, walks children with cursors it reuses, finds paths in one pass over one cursor, and converts spans to UTF-16 once per file. What the index records is unchanged.
