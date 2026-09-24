---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

The scan now records what each file mocks in its parse, in both the JavaScript and the native reader. It does not apply the result: records keep every edge, including type-only and mocked ones, so a question such as which files a test imports gets the whole graph. `mockTaint()` gets its answer from the cached parse and no longer opens or re-parses test files, which matters in a repository with tens of thousands of them. A `mockTaint` given its own `callers` asks something the scan did not, so it still reads the file. `files`, `taintFile` and `taintTable` work as before. `updateSourceIndex` no longer runs a separate taint pass. The source index is now format 10, so an older segment is rebuilt rather than read without its mock columns. The module reader no longer treats a computed member (`vi[mock]`) as a mock, or a computed `['spy']` key as `{ spy: true }`.
