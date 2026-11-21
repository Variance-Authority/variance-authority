---
'@variance-authority/sense': minor
'@variance-authority/help': patch
'@variance-authority/mcp': minor
---

`ask classify` ranks its areas, and `ask containment` finds the trees holding source, in the addon: the files `HEAD` holds are listed and kept in Rust, and only the ten areas, or the trees, cross to JavaScript. `@variance-authority/sense` exports `classifiedAreas` and `pathKinds` in place of `trackedFiles`, which handed every tracked path to the caller: `pathKinds(packages, extensions)` reads a path's package, tree, and whether it is a test or source by one rule in the addon, `.of(files)` for a commit's files and `.sourceTrees(root)` for the trees `HEAD` holds source in. `packageOwner` and `isTestPath` read that same rule. When git cannot answer, the refusal names the command the addon ran and what git said, as `` `git ls-tree -r -z --name-only HEAD` said: fatal: … ``. `Tree` in `@variance-authority/mcp/tools` gains `walk`, the addon-held walk a question over every file it reached is handed.
