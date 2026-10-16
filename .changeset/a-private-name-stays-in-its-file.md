---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A top-level Swift `private` or `fileprivate` declaration, a top-level Kotlin `private` one and a Rust `pub(self)` item are no longer recorded as exports. `variance ask symbol` answers them as declared and not exported. For the Swift and Kotlin names, the answer says nothing outside their file can import them. A Swift `private(set)` property is still published, since it narrows only the setter, and a Rust `pub(crate)` or `pub(super)` item is still published to the crate's other files. The source index format moves to version 22, so `variance index` rebuilds an index written before it.
