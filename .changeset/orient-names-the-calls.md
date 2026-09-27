---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/help': minor
---

`variance ask orient --files` names the calls into and out of each file

`variance index` now walks each case of the latest recording over the static call graph and writes the result beside the source index. `orient --files <path>[:<line>]` reads it: for each file, the functions the most cases ran, the functions in other files that call into it and those it calls, each with its case count and how the call is known, and the package flows those cases take through the file. With a line, the calls narrow to the function holding it, and a line written after the recording says so. When the recording or the index changed after the walk, the answer says `not prepared` and why, and never answers from an older walk. The walk resolves an import the way the test runner did, through each Vite or Vitest config's `resolve.alias`.
