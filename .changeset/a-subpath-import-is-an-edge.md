---
'@variance-authority/sense': patch
'@variance-authority/sense-darwin-arm64': patch
'@variance-authority/sense-linux-arm64-gnu': patch
'@variance-authority/sense-linux-x64-gnu': patch
'@variance-authority/sense-win32-x64-msvc': patch
---

A subpath import such as `import { x } from '#polyfill'` is an edge in the file graph. Both scanners cut every specifier at its first `#`, which is right for a stylesheet's `url(#gradient)` and left a subpath import empty, so a change to the file a `package.json` `imports` map names reached none of its importers. A leading `#` in a module specifier now resolves through the `imports` field, a stylesheet fragment stays external, and `select --execution` can resolve a `#` import a diff added to ask whether its package declares `sideEffects`.
