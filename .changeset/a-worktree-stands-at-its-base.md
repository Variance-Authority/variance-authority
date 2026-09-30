---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

A worktree's first run, or its first landing, seeds a runs record beside the snapshot it copies from the primary checkout: a copy of the primary checkout's runs record, with no run of the worktree's in it. So after partial runs in the worktree, a test it never ran is read from where the primary checkout's record says it last ran, and is selected once a change reaches it. A test that record does not place is read from where its runs started and reported as assumed, in the worktree as in the primary checkout. When the primary checkout has no runs record, or one naming another commit than its snapshot, nothing is seeded. `variance review` in a worktree that has not run still asks for `--since`, and the worktree's first run at the primary checkout's commit starts its own change rather than counting as another run of the primary checkout's.
