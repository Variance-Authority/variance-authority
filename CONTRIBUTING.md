# Contributing

The repository requires Node 22 and Yarn 4 through Corepack.

```bash
yarn install
yarn build
yarn verify
```

`verify` runs lint, documentation and dependency-boundary checks, the cost
measurements, and the test suite. Browser suites skip with a reason when
Chromium is unavailable; install it with:

```bash
npx playwright install chromium
```

## Running less than the whole suite

`yarn test` records which test file executed which region of which module.
`yarn test:since` reads that back and runs the files a change reached:

```bash
yarn test:since
```

It narrows only where it has a measurement. A changed path the snapshot holds no
row for — a file added since the recording, a fixture, a module that cannot
carry a probe — runs everything and names the path that caused it. So a green
`test:since` is a smaller claim than a green `verify`, and `verify` is the gate.

## Reproduce the documented behavior

The Storybook case records new stories, accepts them, proves the next run is
quiet, then changes `Button` and checks that the report resolves the change to
the component and its source line:

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn build
yarn vitest run cases/storybook-case/src/cli.chromium.test.js
```

Reproduce the corpus measurements quoted in the root README with:

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

Unfinished product work lives in [`docs/specs`](docs/specs/README.md); the
current implementation checkpoint lives in
[`docs/context/checkpoint.md`](docs/context/checkpoint.md). The standards a
change is held to — where each kind of writing goes, how a status claim is
recorded, and how a package is named — are in [`AGENTS.md`](AGENTS.md).
