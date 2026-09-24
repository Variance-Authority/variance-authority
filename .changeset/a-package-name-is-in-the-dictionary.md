---
'@variance-authority/sense': patch
'@variance-authority/mcp': patch
---

A source index written before package names joined its dictionary could name a package after the file's first relative specifier. A package imported only by subpath, such as `@variance-authority/core/segment`, had no string of its own in the segment, and its id became row 0: whatever sorted first, which is usually a `../` request. The graph then held a package node called `../exit.js` whose importer never wrote `exit`. A cold cache showed nothing, because it encoded again with the fixed build. The index is now format 9, so every older segment is rebuilt rather than trusted. A decode refuses a stored package name that `packageOf` would not produce, and reads the segment as damaged. The source index, the execution indexes and the MCP source tree now intern through `intern` in `@variance-authority/core/segment`, which throws on a string the dictionary never collected rather than writing row 0.
