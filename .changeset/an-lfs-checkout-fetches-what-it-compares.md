---
'@variance-authority/store': minor
---

An LFS checkout downloads the baselines it compares, not every baseline

A job on the `lfs` placement had to smudge its checkout, which downloads every
baseline in the repository on every run, although a run reads the image of a
subject only when its document moved. Check out with `lfs: false` on
`actions/checkout`, or `GIT_LFS_SKIP_SMUDGE=1`, and run `git lfs install --local
--skip-smudge`: when
`find` meets a pointer, the store runs `git lfs pull --include` for that file
and reads it again. Pointers met while a pull runs go into the next one, so
concurrent lanes share pulls. `describe` and the render cache never fetch.

A pull that fails, or git-lfs missing on an unsmudged clone, is refused with
git-lfs's own error, exit 2, never read as a missing baseline. So is a pointer the
pull left in place, naming `git lfs install --local`, and `tracking.diagnostics`
reports git-lfs installed but not set up, which commits whole images. `verify:
false` still runs no git, so a pointer is refused as before. A smudged checkout never
meets a pointer and never runs a pull.

`createDurableStore` takes `readImage`, the reader `find` uses for the image.
