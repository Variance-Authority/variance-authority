# Contributing

The repository requires Node 22 and Yarn 4 through Corepack.

```bash
yarn install
yarn build
yarn verify
```

`verify` runs lint, documentation and dependency-boundary checks, and the test
suite. Browser suites skip with a reason when Chromium is unavailable; install
it with:

```bash
npx playwright install chromium
```

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

Unfinished product work lives in [`docs/specs`](docs/specs/README.md); the
current implementation checkpoint lives in
[`docs/context/checkpoint.md`](docs/context/checkpoint.md). The standards a
change is held to — where each kind of writing goes, how a status claim is
recorded, and how a package is named — are in [`AGENTS.md`](AGENTS.md).
