---
'@variance-authority/sense': minor
'@variance-authority/help': patch
'@variance-authority/mcp': patch
---

`ask` brings the source index up to date and reads its records, rather than scanning the whole checkout before it answers. On a warm checkout, a question after a one-file edit reads that file again and nothing else.

An MCP host's source tree is read the same way: the index is updated, then read, and a start point's names come from the parses it holds.

`scanRelations` and its `ScanOptions` are removed from `@variance-authority/sense`, with the scan caches it took: `openSourceIndex`, `openParseCache`, `openRecordCache`, `memoryRecordCache` and their types. Read a checkout with `updateSourceIndex`, then `readPublishedSources`, and narrow its records to your directories with `sourcesWithin`. `readPublishedSources` now also returns `indexed`, each file's parse with the target of every request it makes.
