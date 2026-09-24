---
'@variance-authority/sense': patch
'@variance-authority/sense-darwin-arm64': patch
'@variance-authority/sense-linux-arm64-gnu': patch
'@variance-authority/sense-linux-x64-gnu': patch
'@variance-authority/sense-win32-x64-msvc': patch
---

A changed file that one module imports as an asset and another declares with `/// <depends path>` selects the tests behind both. The walk from an asset now follows `depends` edges as well as `asset` edges.
