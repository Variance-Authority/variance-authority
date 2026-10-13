# Baselines through a real git-lfs

This case puts baselines through git-lfs the way a consumer's repository does,
and checks what a clone sees. Every LFS test in `packages/store` drives git
through an injected runner, and every pointer there is a string nobody's clean
filter wrote. Here git-lfs itself writes the pointer on commit, moves the object
on push and smudges it back on clone.

One subject, `swatch`, is a box whose colour `consumer/swatch.txt` holds. The
test records and accepts it, commits and pushes it to a bare repository through
a `file://` URL, and then clones that repository twice:

- **with git-lfs**, the clone holds the bytes that were committed;
- **without git-lfs**, the baseline is pointer text. The clone is made on a
  `PATH` where no `git-lfs` resolves and with a git configuration that has no
  LFS filter, the way a CI machine nobody installed git-lfs on makes one.
  `variance doctor` and `variance doctor --baselines` report
  `POINTERS, NOT IMAGES` and exit 2. A run whose `swatch` document moved refuses
  the subject by name and exits 2, because the run did not happen. With git-lfs
  back and `git lfs pull` run, the same edit is a change, exit 1.

A run on the unsmudged clone whose documents did not move exits 0: an unchanged
subject is settled from its sidecar without the image being opened. That is why
the composite action runs `doctor --baselines` before every run over a store in
the checkout, and `integration.yml` checks that it stops such a clone with
exit 2.

The test never spells where the baselines sit or how many files a subject
writes. It asks git-lfs (`git lfs ls-files -n`) and checks every file it lists,
so the store owns the layout.

## The files

```
consumer/collector.mjs          one subject, `swatch`, coloured from swatch.txt
consumer/variance.config.json   baselines `{ "kind": "lfs", "root": "baselines" }`
src/workflow.chromium.test.js   the git commands, the CLI runs and what each must print
```

## Run it

You need a checkout, `yarn install`, `yarn build`, Chromium
(`npx playwright install chromium`) and git-lfs (`brew install git-lfs` or
`apt-get install git-lfs`). Without either the case skips loudly. Git's
configuration is the test's own: `git lfs install` writes into a file under its
scratch directory, never into yours.

```bash
yarn test:chromium cases/git-lfs-case
```

`VARIANCE_REQUIRE_GIT_LFS=1` turns a missing git-lfs into a failure instead of a
skip. The `cases` job in `check.yml` sets it.

## What it does not test

- The composite action: its commit-back, and its doctor step on a clone of
  pointers. `review (lfs)` in `integration.yml` runs both against a bare
  repository.
- GitHub's LFS server, its quota, or `actions/checkout` with `lfs: true`. The
  remote here is a bare repository on the same disk.
