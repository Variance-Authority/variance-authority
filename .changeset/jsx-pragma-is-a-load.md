---
'@variance-authority/sense': patch
'@variance-authority/sense-darwin-arm64': patch
'@variance-authority/sense-linux-arm64-gnu': patch
'@variance-authority/sense-linux-x64-gnu': patch
'@variance-authority/sense-win32-x64-msvc': patch
---

A JSX pragma comment that is added, removed or given another argument (`@jsx`, `@jsxFrag`, `@jsxImportSource`, `@jsxRuntime`) is now read as a load-time change, so it selects every test that loaded the file. It used to read as `none` and select nothing, although it decides what every element compiles to and which runtime the module imports.
