---
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
---

`variance covering` answers in text a page at a time. A whole file names each test file whose cases called into it once, the most cases first, with its case count, instead of listing every range with every case under it. The ranges no case called into are one line per state; a range is named only when it has something of its own to say, such as lines that moved or text written over since it ran, and the regions no case entered are said once for the file. A line or a function keeps its file rows, nearest first. Either shows ten test files and three cases under each, counts the rest, and ends with the question that asks the next page, spelled whole; `--limit` and `--offset` page it as they page every `ask` listing. On a module 40 test files enter, the whole-file answer fell from 544 KB to 9 KB. `--format json` and `--format refs` name every case, so they refuse `--limit` and `--offset`; a whole file's JSON now also carries `files`, the same test file rows, and a case that only loaded the module on one range but called into another is counted as a caller.

The `record of "<suite>"` line a checkout's own record writes names the latest state its runs landed over and counts the distinct test files of the earlier ones, instead of naming every state, so it no longer grows with every local run.

In `@variance-authority/mcp/tools`, `nextPage` takes the question a caller can spell at a given offset, and then names that whole question as the next page instead of the bare `offset`.
