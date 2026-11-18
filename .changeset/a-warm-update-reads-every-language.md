---
'@variance-authority/sense': patch
---

A warm `variance index` stays native when a change reaches a stylesheet, Python, Rust, Swift, Java or Kotlin file

The addon's warm update used to hand the whole update back to the slower JavaScript path whenever a changed file was not JavaScript or TypeScript. It now reads those files and resolves their imports itself, and the index it publishes is the same, record for record, as the one the JavaScript update writes.

`variance index` now builds every index in the addon, cold or warm. The JavaScript path that took over when the addon declined is gone: a damaged index or one written by another version is rebuilt from scratch, a directory git does not track is refused as the operator's to fix (exit 2, with no defect report), and the parses the update reads are kept for the next checkout as it reads them, not encoded a second time after the save.
