---
'@variance-authority/sense': minor
'@variance-authority/mcp': minor
'@variance-authority/help': minor
'@variance-authority/cli': patch
---

`discover --imports`, `--declares` and their `--except-` sets are answered by one pass over the source index's parses, on every core, rather than by building every file's names for JavaScript to filter. A file is turned into a row only when it matches.

An MCP host that hands `discover` the tree and the checkout now gets its name sets answered; before, they were refused because no names were read with the tree.

`namesFilterOf` is added to `@variance-authority/sense`, and `readSourceParses` with `IndexedParse` is removed. `@variance-authority/mcp` no longer exports `readIndexedNames`, `namesOf`, `DeclaredName`, `FileNames`, `ImportedName` or `SourceNames`, and a tool invocation carries `sourceIndex` — the index the tree was read from — in place of `names`. `@variance-authority/help` replaces `readGenerationNames` with `generationSourceIndex`, and `readNamedTree` no longer takes the question's input.
