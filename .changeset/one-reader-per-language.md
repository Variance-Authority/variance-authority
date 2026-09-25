---
'@variance-authority/sense': minor
---

Python, Rust, Java, Kotlin and Swift are read only by the grammars built into the native addon, and a scan needs the addon to start. The WebAssembly readers are gone, and so are `web-tree-sitter` and the grammar packages that came with them. On a machine where the addon does not load, a scan stops before it opens a file and says why the addon did not load. It no longer lists files it cannot read. If the addon is built without the grammars, files in those five languages are recorded as unknown, with that reason. A scan whose native batch fails now fails with that error. It used to retry file by file without saying so.

Kotlin files now read their package and imports. Until now the addon's Kotlin reader looked for node names from a different Kotlin grammar, so every Kotlin file was recorded as asking for nothing. It also publishes a top-level `typealias` and `val` now.
