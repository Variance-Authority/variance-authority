---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Read component attribution and collection source identity from the native publication

`publishedComponentSources(root, dirs, options)` returns component references, a file count and a content identity from one published source-index snapshot. Configured directories may be relative to the repository or absolute inside it; outside directories are refused. Duplicate component names retain every matching file.

CLI runs and collections use that publication instead of walking and parsing source in JavaScript. `source.dirs` narrows the native publication. Untracked ignored files do not seed its inventory; explicit relative imports can still reach them. `extensions` and `exclude` choose the files that count, for attribution and identity alike; tests, stories, `dist/` and `node_modules` are excluded by default. The index is brought up to the checkout before the read, in CI too, so a run needs no `variance index` step first and an edit since the last one is in the answer. A collection uses the same snapshot for attribution and its build identity.
