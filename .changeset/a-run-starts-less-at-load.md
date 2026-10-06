---
'@variance-authority/sense': patch
---

A test run in a git worktree starts `git` once fewer times when its config loads. The primary checkout's cache directory is read from the worktree's git layout, which already names that checkout's root, so `git rev-parse` is no longer run there a second time. The directories are unchanged.
