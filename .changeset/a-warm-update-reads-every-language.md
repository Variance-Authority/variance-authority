---
'@variance-authority/sense': patch
---

A warm `variance index` stays native when a change reaches a stylesheet, Python, Rust, Swift, Java or Kotlin file

The addon's warm update used to hand the whole update back to the slower JavaScript path whenever a changed file was not JavaScript or TypeScript. It now reads those files and resolves their imports itself, and the index it publishes is the same, record for record, as the one the JavaScript update writes.

`variance index` now builds every index in the addon, cold or warm. The JavaScript path that took over when the addon declined is gone. A damaged index, or one written by another version, is rebuilt from scratch. A directory git does not track is indexed from a walk of the disk, and each update reads all its files again, as before. The parses an update reads are kept for the next checkout as they are read, not encoded a second time after the save.

`scanRelations` now reads and resolves every language in the addon as well, so a scan and an update give one answer from one implementation. Where the two used to differ, the addon's answer is kept: a Python import that only guessed at a file and missed is no longer reported as unresolved, and a request that reaches more than one file records an edge to each.

A cold `variance index` takes about half the time it did on a large TypeScript monorepo: parsing and resolving use every core, a file's existence is answered from git's listing where git lists it, and from one read of each other directory, and a `tsconfig` that fails to load is read once rather than once per file.
