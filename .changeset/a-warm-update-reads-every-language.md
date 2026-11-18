---
'@variance-authority/sense': patch
---

A warm `variance index` stays native when a change reaches a stylesheet, Python, Rust, Swift, Java or Kotlin file

The addon's warm update used to hand the whole update back to the slower JavaScript path whenever a changed file was not JavaScript or TypeScript. It now reads those files and resolves their imports itself, and the index it publishes is the same, record for record, as the one the JavaScript update writes.
