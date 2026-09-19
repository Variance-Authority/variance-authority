# Contributing

You are about to change this repository. This page is how you work in it: what
to install, what `verify` holds you to, how to run less than the whole suite
while an edit is still open, how to reproduce the behaviour the documentation
claims, and what a change owes a release.

## Set up

You need Node 22 or newer and Yarn 4 through Corepack (`corepack enable`); the
exact Yarn version is pinned as `packageManager` in the root
[`package.json`](package.json). **Every command on this page runs from the
repository root.**

```bash
yarn install
yarn build
yarn verify
```

`verify` is `yarn lint && yarn check && yarn measure && yarn test`: oxlint, the
repository checks in `tools/*.check.ts` — every link resolves, every path named
in prose exists, every `file:line` lands where it says, every package declares
what it imports — the `*.measure.ts` cost gates, and the test suite. Browser
suites skip with a reason when Chromium is unavailable; install it with:

```bash
npx playwright install chromium
```

Build before you verify, and again after you pull. Nothing here imports another
package by relative path, so a check that asks the CLI what a setting means
resolves through the manifest's `exports` into `dist/`, the same path a consumer
takes. A missing build says so; a stale one answers every question fluently and
answers some of them wrong, and the wrong answer arrives dressed as a defect in
whatever was asked about.

## Running less than the whole suite

`yarn test` records which test file executed which part of which module, and
writes that to a snapshot. `yarn test:since` reads the snapshot back and runs
the files your change reached:

```bash
yarn test:since             # since the commit the snapshot was recorded at
yarn test:since main        # since the merge base with main
yarn test:since --dry-run   # print the reading, run nothing
```

It narrows only where it has a measurement. A changed path the snapshot holds no
row for — a file added since the recording, a fixture, a module that cannot
carry a probe — runs everything and names the path that caused it:

```
$ yarn test:since --dry-run
test:since: running the whole suite — the snapshot has no measurement of
packages/core/README.md and 30 other path(s), so it cannot say who entered it.
  429 files
```

So a green `test:since` is a smaller claim than a green `verify`, and `verify` is
the gate.

Each selected test also carries its distance from the change: how many imports
separate them, counted through the modules that test actually entered. The
nearest tests fail first and for the simplest reason, so you can run them while
the edit is still open and leave the rest for later:

```bash
yarn test:since --at-distance 0-2   # within two imports of the change
yarn test:since --at-distance 3-    # the rest of the selection
yarn test:since --help              # every flag
```

`0-2` means *no more than two imports away*. Zero is a test whose own source you
edited. Tests whose distance could not be measured run with the leg that reaches
the end, so those two commands together run every selected file exactly once.
[`docs/distance.md`](docs/distance.md) is the reference; `--help` prints the
whole surface:

```
$ yarn test:since --help
test:since — run the tests a change reached, nearest first.

usage: yarn test:since [<ref>] [--at-distance <range>] [--dry-run]

  <ref>                 measure from the merge base with this ref.
                        Defaults to the commit the snapshot was recorded at.
  --at-distance <range> run only the tests this many imports from the change.
                        `0-2`, `2`, or `3-`. Zero is a test whose own source
                        you edited. Tests with no measurable distance ride
                        with the leg that reaches the end.
  --dry-run             print the reading and run nothing.
  --help                this.
```

Every run prints the whole reading before the leg it took out of it, the files a
leg left for later, and two findings that need no red test: imports that reached
past a unit face, and tests the change entered by no route they imported.

## Reproduce the documented behavior

[`cases/storybook-case`](cases/storybook-case) builds a real Storybook with
`storybook build`, records its stories, accepts them, checks that the next run is
quiet, then builds a second Storybook in which `Button` — from
`cases/storybook-case/src/ds.jsx` — renders wider, and checks that the report
resolves that change back to the component and its source line. It needs
Chromium and a current `yarn build`, because the test drives the CLI as a
process out of `packages/cli/dist`:

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn build
yarn vitest run cases/storybook-case/src/cli.chromium.test.js
```

The corpus measurements quoted in the root [`README.md`](README.md) come from two
files in [`examples/kitchen-sink`](examples/kitchen-sink); the first runs under
jsdom and needs no browser, the second needs Chromium:

```bash
yarn vitest run examples/kitchen-sink/src/measure.test.tsx
yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

## Releasing

A change that reaches the registry arrives carrying a changeset:

```bash
yarn changeset
```

Pick the bump the *product* deserves. The packages are one `fixed` group — every
`@variance-authority/*` package shares a version, because internal dependencies
are `workspace:^` and a release ships all of them — so marking one marks them
all. [`.changeset/README.md`](.changeset/README.md) says what else is unusual
here.

**No merge publishes anything.** [`release.yml`](.github/workflows/release.yml)
collects the changesets on `main` into one "Version packages" pull request;
merging that moves the version numbers and writes the changelogs, and still
sends nothing to a registry. Publishing is the `release` workflow run by hand,
from the Actions tab, on whatever `main` carries at that moment — it refuses to
run while a changeset is still waiting to be versioned. The dist-tag is derived
from the version rather than typed at release time.

## Where the rest lives

The standards a change is held to — where each kind of writing goes, how a
status claim is recorded, and how a package is named — are in
[`AGENTS.md`](AGENTS.md). Unfinished product work lives in
[`docs/specs`](docs/specs/README.md); the current implementation checkpoint lives
in [`docs/context/checkpoint.md`](docs/context/checkpoint.md).
