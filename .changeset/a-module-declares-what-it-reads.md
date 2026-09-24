---
'@variance-authority/core': minor
'@variance-authority/sense': minor
'@variance-authority/sense-darwin-arm64': minor
'@variance-authority/sense-linux-arm64-gnu': minor
'@variance-authority/sense-linux-x64-gnu': minor
'@variance-authority/sense-win32-x64-msvc': minor
---

A module can name a file it reads without importing it:
`/// <depends path="./schema.graphql" />`, anywhere in the file. The scan draws
a `depends` edge to that file, so a change to it reaches the tests that load
the module. TypeScript and every runtime read the line as a comment. A directive
that names no `path` is reported in the file's `unknown`. The source index
format moves to version 11, so an existing index is read again once.
