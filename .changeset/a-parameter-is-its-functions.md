---
'@variance-authority/sense': minor
'@variance-authority/sense-darwin-arm64': minor
'@variance-authority/sense-linux-arm64-gnu': minor
'@variance-authority/sense-linux-x64-gnu': minor
'@variance-authority/sense-win32-x64-msvc': minor
---

A function's region now starts at its parameter list, not at its body. An edit
to a parameter selects the tests that called the function. Before, it selected
every test that loaded the module around the function. A function in a
parameter's default value is now owned by the function whose parameter it is.
The instrumentation ids are now `sense:instrument/presence-v5` and
`sense:instrument/entries-v2`, so a recording made under the old ids is read as
stale and recorded again.
