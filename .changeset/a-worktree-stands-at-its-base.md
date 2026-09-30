---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

A worktree's first run, or its first landing, seeds a runs record beside the snapshot it copies from the primary checkout. The record carries the primary checkout's `commit`, `files` and `standing`, and lists any test the primary checkout's record does not place at that record's `over`, where the primary checkout reads it. So after partial runs in the worktree, a test it never ran is still read from where it last ran, and `test:since` selects it once a change reaches it. When the primary checkout has no runs record, or one naming another commit than its snapshot, nothing is seeded, and `test:since` in the worktree names the tests it could not place. The seeded record is linked into place, so a runs record a landing wrote first is kept. The seeded record has `runs: 0` and no `over`. `variance review` treats it as no run of the worktree's, and the worktree's first run at the same commit starts its own change rather than counting as another run of the primary checkout's.
