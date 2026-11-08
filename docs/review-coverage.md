# Review coverage on every pull request

A Jest or Vitest library on GitHub can get one comment on each pull request that
names the changed functions no test ran and what the change stopped running
that its main branch ran. The comparison with the main branch is kept between
runs in the GitHub Actions cache, and a badge on the README is one more line.
Your workflow names your test command and one action.

## Record your tests

The comment reads which functions each test ran, which your tests record when
their configuration is wrapped. Install the recorder and the command line that
reads what it records:

```bash
npm install --save-dev @variance-authority/sense @variance-authority/cli
```

Wrap your Jest configuration once:

```js
// jest.config.mjs
import { withTestSelection } from '@variance-authority/sense/jest';

export default withTestSelection({
  testEnvironment: 'node',
});
```

For Vitest, import `withTestSelection` from `@variance-authority/sense/vitest`
and wrap `defineConfig(...)` the same way. Then name the tests in
`variance.config.json` at the repository root. `unit` is the name the workflow
uses for them, and `"carry": "actions-cache"` keeps what they ran in the GitHub
Actions cache between runs:

```json
{
  "suites": { "unit": { "kind": "unit", "carry": "actions-cache" } }
}
```

The review writes its comment under `.variance/` in the checkout. Add
`.variance/` to your `.gitignore`, so a review run on your own machine is never
committed.

## Add the job

This is the whole workflow, for npm and Jest:

```yaml
name: tests
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read # the checkout
      pull-requests: write # the comment
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # the review reads the change from where it starts
      - uses: actions/setup-node@v7
        with:
          node-version: 24 # the CLI needs 22.15 or newer
      - run: npm ci
      - uses: Variance-Authority/action/review@v1
        with:
          suite: unit
          test: npx jest
```

The action runs `test`, reviews what it ran, and saves the record: which
functions each test ran. A push to `main` saves the record every pull request compares with. A pull request's
push saves what the next push of the same pull request reads. A failing test
still gets its comment, then fails the job with the test's exit code.

`test` and the install step are your own; the action installs nothing. With
pnpm, run `pnpm install --frozen-lockfile` and set `test: pnpm exec vitest run`;
with Yarn, `yarn install --frozen-lockfile` and `test: yarn jest`.

## The first runs

Until `main` has run the job once, the comment says it has nothing on `main` to
compare with, and still names the changed functions this run's tests did not
reach. Merge the workflow, let `main` run it, and the next pull request
compares with that record. On a push there is no pull request, so the review
goes to the job's summary.

A pull request from a fork gets a token that cannot comment. The review is
still in the job's summary, and the job warns rather than fails.

## Require it, or show a badge

Both are inputs of the same step:

```yaml
- uses: Variance-Authority/action/review@v1
  with:
    suite: unit
    test: npx jest
    fail-on-uncovered: 'true'
    badge: 'true'
```

`fail-on-uncovered` fails the job, after the comment, when a changed function
holds code no test ran. Name the job as a required check in your branch rule, and
such a pull request cannot merge until a test runs it.

`badge` publishes, on every push to the default branch, the share of regions
your tests ran: a region is a function, a branch, or a run of statements with no
decision in it, so the figure is lower than line coverage. The action pushes it
as one file to the git ref `refs/badge/<default-branch>`, replaced each time, for
a [shields.io](https://shields.io/badges/endpoint-badge) endpoint badge. Add
`contents: write` to the job's `permissions`, and put the badge in your README
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
