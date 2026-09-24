---
"@variance-authority/cli": patch
"@variance-authority/sense": patch
"@variance-authority/sense-darwin-arm64": patch
"@variance-authority/sense-linux-arm64-gnu": patch
"@variance-authority/sense-linux-x64-gnu": patch
"@variance-authority/sense-win32-x64-msvc": patch
---

`variance run --since` and `variance select` print one line per changed file saying how it was read, or why it was not, and name each test that loaded it through an import the file graph does not list; `variance select --format json` gives the same readings as `readings`, and `@variance-authority/sense/test-selection` exports the formatter as `readingLines`.
