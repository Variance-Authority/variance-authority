---
'@variance-authority/sense': patch
'@variance-authority/sense-darwin-arm64': patch
'@variance-authority/sense-linux-x64-gnu': patch
'@variance-authority/sense-win32-x64-msvc': patch
---

Instrument modules in the native scanner

`instrument()` now parses, walks and splices in the addon, so the syntax tree
never crosses into JavaScript: 64 µs a module instead of 161 µs over this
repository's sources, byte for byte the same output. Without the addon, the
JavaScript walk answers as before.

A module whose first statement after its imports is a top-level `await` no
longer loses its probe runtime: the header used to land inside the `await`'s
probe and was not declared.

The scanner on Apple Silicon hashes with the ARMv8 SHA instructions, five
times faster than before, which every digest it takes shares.
