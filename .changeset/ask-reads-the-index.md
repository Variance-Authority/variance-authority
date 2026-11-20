---
'@variance-authority/sense': minor
'@variance-authority/help': patch
'@variance-authority/mcp': patch
---

`ask` brings the source index up to date and reads its records, rather than scanning the whole checkout before it answers. On a warm checkout, a question after a one-file edit reads that file again and nothing else. `--changed-file` still asks for a new generation now, and an empty list still keeps the one published, but a list no longer narrows the read: the index finds what moved from Git and reads those files again, listed or not.

An MCP host's source tree is read the same way: the index is updated, then read, and a start point's names come from the parses it holds. Without `index` it now writes the checkout's own source index, and a tree whose index cannot be written is refused rather than answered from memory.

`scanRelations` and its `ScanOptions` are removed from `@variance-authority/sense`, with the scan caches it took: `openSourceIndex`, `openParseCache`, `openRecordCache`, `memoryRecordCache` and their types. The update does not take the scanner's `tsconfig`, `conditionNames`, `largestFile`, `digests`, `parsed`, `indexed`, `stores` or `changed` options: it reads the tsconfig `variance.config.json` names, the default conditions and the files Git says moved. Read a checkout with `updateSourceIndex`, then `readPublishedSources`, and narrow its records to your directories with `sourcesWithin`. `readPublishedSources` now also returns `indexed`, each file's parse with the target of every request it makes.
