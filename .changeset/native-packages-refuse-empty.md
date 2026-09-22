---
'@variance-authority/sense-darwin-arm64': patch
'@variance-authority/sense-linux-x64-gnu': patch
'@variance-authority/sense-win32-x64-msvc': patch
---

Refuse to publish a native Sense package without its scanner binary

Each platform package checks that `scan.node` exists and is large enough to be
the compiled scanner before a pack or publish can proceed.
