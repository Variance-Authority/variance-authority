---
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`ask search` now prints, beside each published name, the places that import it and the packages those places sit in, counted as `ask uses` counts them: `imported in 5 places in 2 packages`, or `imported nowhere`. Before, it printed `2 packages, 3 imports`. That number counted only imports by a published path from other packages, but it read as every import. The rows a page shows are ordered by the count they print. Search counts only the rows it shows, and opens the Help value only when one of them is a published name.

Without the Help value, and in `entrypoint`'s rows, the narrower count is printed under its own name: `3 imports by published path from 2 other packages`, or `no other package imports it by its published path`.

JSON changes:

- A published match carries `importedIn: { places, packages }`.
- Its `packages` and `imports` fields are renamed `otherPackages` and `otherImports`.
- The answer carries `importsUnread` when the source index did not read, so imports by file path were not counted.

When the Help value is published but does not open, an answer that shows a published name says so beside the index counts it prints instead.

Breaking for code that builds a `SearchReading` itself: it now requires `value`, a thunk that reads the Help value on demand. `countingShown` calls it.
