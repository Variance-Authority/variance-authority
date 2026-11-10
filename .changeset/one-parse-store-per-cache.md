---
"@variance-authority/sense": patch
---

An index of a directory or a worktree no longer parses again the modules another root in the same cache has already read. The cache keeps one parse store, keyed by a module's bytes and how they are read, that every root reads before it parses, and the cache prune reclaims the parses no root names.
