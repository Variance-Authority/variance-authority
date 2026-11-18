---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Read component attribution and collection source identity from the native publication

`publishedComponentSources(root, dirs, options)` returns component references, a file count and a content identity from one published source-index snapshot. Configured directories may be relative to the repository or absolute inside it; outside directories are refused. Duplicate component names retain every matching file.

CLI runs and collections use that publication instead of walking and parsing source in JavaScript. `source.dirs` narrows the native inventory; in Git checkouts it excludes Git-ignored source, and test and story files participate in the source identity. Run `variance index` after source changes and before collecting evidence. A collection uses the same snapshot for attribution and its build identity.
