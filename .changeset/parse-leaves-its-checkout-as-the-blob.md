---
"@variance-authority/sense": patch
---

A parse of a tracked file enters the shared parse store only when the bytes it was made from are the blob git named for that file. A checkout whose file differs from its blob without git saying so — edited under `git update-index --assume-unchanged` or `--skip-worktree`, or changed after the listing was read — keeps that parse in its own index, so another checkout of the same blob no longer takes imports the blob does not have. Parses read off disk whose bytes are the blob are still shared.
