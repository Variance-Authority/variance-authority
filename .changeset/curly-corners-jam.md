---
"@variance-authority/sense": patch
---

Read the working inventory from Git's index instead of traversing HEAD's object trees. Reuse the loaded index to detect local changes, and retain Git's handling of filesystem monitors, untracked caches and sparse checkouts. Indexing no longer opens the object store or maintains a separate committed-tree cache just to list files.
