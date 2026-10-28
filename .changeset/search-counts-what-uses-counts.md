---
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`ask search` labels each count it prints with what it counts. Beside a published name it now says the places that import it and the packages those sit in — `imported in 5 places in 2 packages` — counted as `ask uses` counts them, so the two agree; it is counted for the rows shown only, the Help value is opened only when those rows include a published name, and the stored index is unchanged. Before, it printed `2 packages, 3 imports`, which counted only other packages' imports by a published path and read as every import. Without the Help value, and in `entrypoint`'s rows, the count that is printed says so: `3 imports by published path from 2 other packages`. In JSON a published match carries `importedIn: { places, packages }`, and its `packages` and `imports` fields are renamed `otherPackages` and `otherImports`; the answer carries `importsUnread` when the source index did not read and imports by file path could not be counted. When the Help value is published and does not open, an answer that shows a published name says so beside the index's counts it prints instead.
