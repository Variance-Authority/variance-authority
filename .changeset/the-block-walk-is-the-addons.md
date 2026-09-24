---
'@variance-authority/sense': minor
'@variance-authority/sense-darwin-arm64': minor
'@variance-authority/sense-linux-arm64-gnu': minor
'@variance-authority/sense-linux-x64-gnu': minor
'@variance-authority/sense-win32-x64-msvc': minor
---

Instrumentation now runs in the native addon only. `instrument()` without the
addon throws and names the package that did not load, rather than recording
nothing. The addon now names a regular-expression key as `String(regex)` does,
and writes a lone surrogate in a key as `\uXXXX`. A source whose text holds a
lone surrogate is left uninstrumented. The `Edit` type is removed from
`@variance-authority/sense/instrument`.
