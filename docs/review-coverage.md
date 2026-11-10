# Review coverage on every pull request

A Jest or Vitest library on GitHub can get one comment on each pull request that
names the changed functions no test ran and what the change stopped running
that its main branch ran. The comparison with the main branch is kept between
runs in the GitHub Actions cache, and a badge on the README is one more line.
Your workflow names your test command and one action.

## Record your tests

The comment reads which functions each test ran, which your tests record when
their configuration is wrapped. Install the recorder and the command line that
reads what it records, with your package manager:

```bash
npm install --save-dev @variance-authority/sense @variance-authority/cli
pnpm add --save-dev @variance-authority/sense @variance-authority/cli
yarn add --dev @variance-authority/sense @variance-authority/cli
```

Keep the Jest configuration you have and wrap what it exports. Jest refuses two
configuration files, so do not add a second one beside it. A `jest.config.js`
in CommonJS:

```js
// jest.config.js
const { withTestSelection } = require('@variance-authority/sense/jest');

module.exports = withTestSelection({
  preset: 'ts-jest',
  testEnvironment: 'node',
});
```

A `preset` and a `transform` with its own options stay as they are: the wrap
keeps each transformer, on the same pattern with the same options, and wraps
it, so copy nothing from a preset into your file. In a `jest.config.mjs` or `jest.config.ts`, `import {
withTestSelection } from '@variance-authority/sense/jest'` and wrap the default
export the same way. For Vitest, wrap `defineConfig` in the configuration you
have:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(defineConfig({ test: {} }));
```

Then name the tests in `variance.config.json` at the repository root. `unit` is
the name the workflow uses for them, and `"carry": "actions-cache"` keeps what
they ran in the GitHub Actions cache between runs:

```json
{
  "suites": { "unit": { "kind": "unit", "carry": "actions-cache" } }
}
```

In CI the action keeps its working files, the review and what each push ran,
under `.variance/` in the checkout. Add `.variance/` to your `.gitignore`, so
those files are never committed from a checkout where they were made.

## Check it on your machine

The CLI needs Node 22.15 or newer, on your machine as in CI. Raise only the Node
you run: `.nvmrc`, and `node-version` in the workflow. Leave `engines` in
`package.json` alone; it says what your library asks of its users. Run your
tests once with your usual command, then name a source file they import, in
place of `src/index.ts`:

```bash
variance covering --file src/index.ts
```

On the first run it says it is building its [source index](source-index.md) from the checkout;
that line is expected. Then it prints the suite, `unit (unit):`, the file with
how many recorded ranges and named tests reached it, and how long ago that run
landed. Named tests on the file mean the wrap recorded them; no line for `unit`
means the tests ran without the wrap. On your machine the record is kept under
`node_modules/.cache/`, not under `.variance/`.

## Add the job

This is the whole workflow, for npm and Jest. If you already have a test job,
replace its test step with the action rather than adding this workflow beside
it, or your tests run twice. When that job runs a matrix of Node versions, keep
it as it is and add the `review` job beside it, once, in the same workflow:

```yaml
name: tests
on:
  push:
    branches: [main] # your default branch: master, if that is its name
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read # the checkout, and nothing it could write with
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # the review reads the change from where it starts
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24 # the CLI needs 22.15 or newer
      - run: npm ci
      - uses: Variance-Authority/action/review@v1
        with:
          suite: unit
          test: npx jest
          comment: 'false' # hand the review to the job below

  post:
    needs: review
    if: ${{ !cancelled() && needs.review.result != 'skipped' }}
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write # the comment
    steps:
      - uses: Variance-Authority/action/review@v1
        with:
          from: variance-review
```

The action runs `test`, reviews what it ran, and saves the record: which
functions each test ran. A push to the default branch saves the record every
pull request compares with. A pull request's push saves what the next push of
the same pull request reads. A failing test still gets its comment, then fails
the job with the test's exit code.

Two jobs, because the first runs the pull request's code: a test, or a package
it installs, can read whatever token its job holds, and GitHub stops what a
step left running only when the job ends. So that job can read and nothing more,
and the `post` job, which checks nothing out and runs no code of the pull
request, holds the write token and posts what the first handed it.

`test` and the install step are your own; the action installs nothing, so
whatever your tests need first, such as a build, is a step before it. Keep the
steps that set up your package manager, such as `pnpm/action-setup` and
setup-node's `cache:`. With pnpm, run `pnpm install --frozen-lockfile` and set
`test: pnpm exec jest` or `pnpm exec vitest run`; with Yarn, `yarn install --immutable` (`--frozen-lockfile` on Yarn 1) and
`test: yarn jest`.

## The first runs

Until your default branch has run the job once, the comment says it has
nothing to compare with, and still names the changed functions this run's tests did not
reach. Merge the workflow, let the default branch run it, and the next pull request
compares with that record. On a push there is no pull request, so the review
goes to the job's summary.

A pull request from a fork gets a token that cannot comment. The review is
still in the job's summary, and the `post` job warns rather than fails.

## Require it, or show a badge

Both are inputs of the `review` job's step:

```yaml
- uses: Variance-Authority/action/review@v1 # in `review`
  with:
    suite: unit
    test: npx jest
    comment: 'false'
    fail-on-uncovered: 'true'
    badge: 'true'
```

`fail-on-uncovered` fails the `review` job, after it hands the review on, when a changed function
holds code no test ran. Name the `review` job as a required check in your branch rule, and
such a pull request cannot merge until a test runs it.

`badge` publishes, on every push to the default branch, the share of regions
your tests ran: a region is a function, a branch, or a run of statements with no
decision in it, so the figure is lower than line coverage. The action pushes it
as one file to the git ref `refs/badge/<default-branch>`, replaced each time, for
a [shields.io](https://shields.io/badges/endpoint-badge) endpoint badge. The
`review` job counts the figure and hands it on; the `post` job pushes it, so give
that one `contents: write` beside `pull-requests: write`. Put the badge in your README
with your owner, repository and default branch:

```markdown
[![regions run](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2F<owner>%2F<repo>%2Frefs%2Fbadge%2F<default-branch>%2Fregions-run.json)](https://github.com/<owner>/<repo>/actions)
```

The badge is for a public repository: shields.io cannot read a private one.

## Go deeper

- [The review action's reference](https://github.com/Variance-Authority/action#reviewing-a-project-with-only-unit-tests)
  holds every input, and the recipe for a suite shared between jobs.
- [Compare coverage services](compare-coverage.md) says what the comment
  counts and what it does not replace.
- [Run the tests an edit needs](test-an-edit.md) uses the same record to skip
  the tests a change did not reach.
