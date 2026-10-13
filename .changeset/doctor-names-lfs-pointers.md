---
'@variance-authority/cli': minor
'@variance-authority/store': patch
---

`variance doctor --baselines` refuses a checkout of git-LFS pointers, and the action asks it before every run

On a clone that skipped the LFS fetch, a subject whose page did not move is
settled from its sidecar without its image being read, so `variance run` passed
until the first subject that moved met the pointer. `variance doctor` now reads
the head of every image in an `lfs` root, counts the ones that are git-LFS
pointers, names the first under *POINTERS, NOT IMAGES*, prints
`git lfs install && git lfs pull`, and exits 2, the code the run exits with when
it meets one. It exits 2 for that finding under a remote renderer as well.

`variance doctor --baselines` asks the same of the store alone: no browser is
opened and no font measured. The composite action in `.github/actions/variance`
runs it before every run over a store in the checkout, so a job that uses the
action stops with exit 2 on such a clone instead of passing.

`@variance-authority/store/lfs` exports the test both use: `isLfsPointer(head)`,
and `LFS_POINTER_HEAD_BYTES`, how many leading bytes it needs.
