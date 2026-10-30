---
'@variance-authority/core': patch
'@variance-authority/store': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A git-LFS pointer is no longer read as the file it stands for. The text of a source file at a recorded commit, when git holds it as a pointer, is the content `git lfs smudge` gives, and the read fails with git-lfs's own words when it cannot give it. A baseline record that is a pointer is refused as one, by `find`, `describe` and `accept` alike, rather than called a truncated write or written over. `isLfsPointer` and `LFS_POINTER_HEAD_BYTES` now come from `@variance-authority/core`; `@variance-authority/store/lfs` no longer exports them.
