---
"@variance-authority/sense": patch
"@variance-authority/help": patch
"@variance-authority/cli": patch
---

A parse of a tracked file enters the shared parse store only when the bytes it was made from are the blob git named for that file. A checkout whose file differs from its blob without git saying so — edited under `git update-index --assume-unchanged` or `--skip-worktree`, or changed after the listing was read — keeps that parse in its own index, so another checkout of the same blob no longer takes imports the blob does not have. A blob one checkout read as other bytes at any of its paths is not offered from that checkout at all, and a module read with `packs: false` is not offered. Parses read off disk whose bytes are the blob are still shared.

A worktree's source index is built from nothing instead of from a copy of its primary checkout's index, which carried records of bytes that were not the blob into a clean worktree. Its first update reads every file and still parses none the primary checkout's update put in the parse store. `updateSourceIndex` no longer takes `primary` or answers `from`, `primarySourceIndexPath` is removed, and `variance index` in a worktree prints `source index built:` as in any checkout. An index named in the checkout's own cache directory, such as the one `variance docs` keeps for a workspace whose member list reaches beside its root, now reads the parse store too.
