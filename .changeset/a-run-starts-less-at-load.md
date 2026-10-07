---
'@variance-authority/sense': patch
---

Loading a Vitest config that uses `withTestSelection` does less before the first test runs:

- Importing `@variance-authority/sense/vitest` no longer loads the package's whole index, or `oxc-parser` and `oxc-resolver` with their native bindings, which nothing in the seam uses. The import takes about 20 ms instead of 34 ms.
- In a git worktree, `git rev-parse` runs once instead of twice. The primary checkout's cache directory is read from the worktree's git layout, which already names that checkout's root. The directories are unchanged.
