---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

A worktree's first run, or its first landing, seeds a runs record beside the snapshot it copies from the primary checkout. The record carries the primary checkout's `commit`, `files` and `standing`. When the primary checkout has no runs record, the seed lists every test as run at its snapshot's commit. So after partial runs in the worktree, a test it never ran is still read from where it last ran, and `test:since` selects it once a change reaches it. When the primary checkout's runs record names another commit than its snapshot, nothing is seeded. The seeded record has `runs: 0` and no `over`. `variance review` treats it as no run of the worktree's, and the worktree's first run at the same commit starts its own change rather than counting as another run of the primary checkout's.
