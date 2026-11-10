# Variance Authority action

This action runs the `variance` CLI your project already installed over a pull
request. The CLI's exit code sets the check's colour. Around that run, the
action does the three things a command line cannot do for itself:

- It posts the result to the pull request as one comment, updated in place.
- It restores and saves the baselines the Actions cache carries.
- It accepts a change on a run a person asked for, such as a dispatch or the
  run a [tick](#accepting-with-a-tick) starts.

A project with only unit tests has nothing to observe, and
[`Variance-Authority/action/review`](#reviewing-a-project-with-only-unit-tests)
posts its coverage review instead.

```yaml
permissions:
  contents: read # the checkout: a declared block sets the rest to none
  pull-requests: write # the comment

steps:
  - uses: actions/checkout@v7
  - run: npm ci
  - uses: Variance-Authority/action@v1
    with:
      config: variance.config.json
      github-token: ${{ secrets.GITHUB_TOKEN }}
```

`v1` is the major of the action's inputs and outputs, and every release that
keeps them compatible moves it. The action calls the CLI from your
`node_modules`, whatever version your lockfile holds, and downloads nothing
during the run. These steps are the action alone:
[the whole job](https://variance-authority.dev/docs/placement#the-whole-job)
adds Node, the browser and the accept.

Every input is described in [`action.yml`](action.yml). The
[CLI reference](https://variance-authority.dev/reference/packages/cli#run-it-in-ci) covers
running it in CI, including how to accept a change and where the baselines can
live.

Released from
[Variance-Authority/variance-authority](https://github.com/Variance-Authority/variance-authority).
MIT.

## Reviewing a project with only unit tests

`Variance-Authority/action/review` runs your tests, then `variance review
--coverage`, and posts what it wrote as one comment of its own, updated in place
on every push. The comment stays beside a docket and never replaces one. It needs
no `config`: the tests have to run under
[the recorder](https://variance-authority.dev/docs/test-an-edit), for a suite the root `variance.config.json` declares with
`"suites": { "unit": { "kind": "unit", "carry": "actions-cache" } }`.

The job that runs your tests runs the pull request's code, so it holds no write
token. `comment: 'false'` hands the review on as the artifact `variance-review`,
and a second job, which runs none of that code, posts it with `from`:

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read # the checkout: a declared block sets the rest to none
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
          comment: 'false'

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

With `from` the action checks nothing out, runs no CLI and installs nothing: it
downloads the review, posts the comment and marks the diff. A red test still
uploads the review, so the post job runs and the comment says what ran. One job
with both, and `pull-requests: write`, still works: it is the shape to use only
where every pull request's code is already trusted.

[Review coverage on every pull request](https://variance-authority.dev/docs/review-coverage)
walks through the whole setup, from wrapping the tests to the badge.

`test` is your command, with your package manager: `pnpm exec jest` or `yarn
jest` work the same. The action restores the suite's record from the runner
cache, sets the mainline's record aside before the tests write over it, runs the
command, reviews, and saves what the tests ran: on a push to a mainline the
record every pull request compares with, and on a pull request what its next push
reads. A red test still reviews and saves, then fails the step with the test's
exit code.

Without `test` the action reviews the record a step before it left, and the
mainline record comes from `against`: the `against-<suite>` output of a `variance
carry take` your workflow ran before the tests.

Coverage has two bases. The record `test` carries, or `against`, is compared with
the suite `suite` names, and only that suite: without `suite` the coverage rows
do not read it. Otherwise a suite
declared with `"carry": "share"` is compared with the record its mainline
published through [the share](https://variance-authority.dev/docs/sharing), and
needs neither `test` nor `against`. Any other suite, and any suite
before its mainline has a record, reads "No baseline available; change cannot be
compared" on every comment.

A pull request checks out as its head merged into the base tip, so a shared
suite compares with a record made before what the base gained since. Merge the
head with the record's commit before this step, and the comparison holds the
pull request alone:

```yaml
- id: merge
  if: github.event_name == 'pull_request'
  env:
    COMMIT: ${{ steps.record.outputs.commit }}
  run: npx --no-install variance carry merge "$COMMIT" --on-conflict stay --format github >> "$GITHUB_OUTPUT"
```

`steps.record` is a step that ran `npx --no-install variance share --suite <name> --format
github`. The merge prints `merged=true` and `checkout=<sha>`, or `merged=false`
when there was no commit or the head conflicts with it.
[Sharing](https://variance-authority.dev/docs/sharing#a-pull-request-that-runs-the-mainlines-changes-too)
has the whole job.

The review needs the commit the change starts from and a diff from it, so check
out every commit: `fetch-depth: 0`, with `filter: tree:0` to leave the trees out.
A clone that lacks that commit fails the step, and the CLI says what to fetch.
With several suites declared, `suite` is required too. On a push there is no pull request, so the review reaches the step summary alone, and a repository's first commit has no start to review from.

A review finds nothing a person must approve, so by default it has no verdict
and no outputs. The step fails when no review could be written, and when the
comment could not be posted: a 500 from GitHub fails it. A token that cannot
write only warns, and the review is still in the step summary. A failed review
posts nothing, so the comment from the last good push stays in place. A project
with a surface as well runs both actions.

### Requiring that a change's functions ran

`fail-on-uncovered: 'true'` turns the count the review prints into a check: the
step posts the comment first, or hands it on, then fails when a changed function holds code no
case ran. Name the job as a required status check in your branch rule, and a
pull request with such a function cannot merge until a case runs it.

```yaml
- uses: Variance-Authority/action/review@v1
  with:
    suite: unit
    test: npx jest
    fail-on-uncovered: 'true'
```

It is a count, not a percentage: one function is enough, and nothing is compared
with a threshold. The step also fails, with no comment, when the record does not
hold the change, or when source changed and nothing shows a run of this change,
because then which functions ran is not known.

A file a run of this change did not load is not in the count: a run that never
loaded a file has no answer about it, and a build script or a configuration file
is often exactly that. The step's log names each one, and the check stays green if
nothing else is counted, so a source file nothing imports passes it, with new
functions or edited ones.

Each changed function no case covered in a run of the change is also marked in
the diff, as a warning on the first lines the change wrote in it. GitHub shows ten
of a step's warnings, so a longer list ends with a note of how many it left out.
A file no suite ran as the tree holds it marks nothing: a record older than the
change has not run what the change wrote. With several suites, a suite that has not run the change answers for
nothing, so a function only that suite reaches is marked until it does.

### Requiring that a change keeps running what the mainline ran

`fail-on-lost: 'true'` fails the step, after the comment, when a suite's base ran
a region no case runs now, or ran a file the checkout still holds and no test
loads. It takes `against`: with no base nothing is compared,
which the step says and does not fail on.

```yaml
- uses: Variance-Authority/action/review@v1
  with:
    suite: unit
    test: npx jest
    fail-on-lost: 'true'
```

### Publishing a badge

`badge: 'true'` publishes the figure `variance coverage` prints first, on a push
to your default branch, for a [shields.io](https://shields.io/badges/endpoint-badge)
endpoint badge. The step writes `regions-run.json` as the one file of a commit
with no parent and pushes it to `refs/badge/<branch>`, replacing what was there,
so the ref never grows a history. The job that runs the tests counts the
figure and hands it on with the review; the job with `from` pushes it, and needs
`contents: write` for that push:

```yaml
  review:
    # ... as above
      - uses: Variance-Authority/action/review@v1
        with:
          suite: unit
          test: npx jest
          comment: 'false'
          badge: 'true'

  post:
    # ... as above
    permissions:
      contents: write # the badge, on a push to the default branch
      pull-requests: write # the comment
    steps:
      - uses: Variance-Authority/action/review@v1
        with:
          from: variance-review
```

Then put the badge in your `README.md`, with your owner, repository and branch
in the URL:

```markdown
[![regions run](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2F<owner>%2F<repo>%2Frefs%2Fbadge%2F<default-branch>%2Fregions-run.json)](https://github.com/<owner>/<repo>/actions)
```

The badge is for a public repository: raw.githubusercontent.com serves a private
repository's files only to a request with a token, and shields.io sends none. A
run with no region counted, or a token that cannot push, warns and leaves the
last badge in place. On a pull request the step does nothing.

## Sharding a visual review

`shard: k/n` runs one slice of the suite. A slice is not the suite, so each
shard comments nothing and uploads its report; a last job hands every report
to `reports` and gets the suite's one docket and one check colour:

```yaml
jobs:
  shard:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1/3, 2/3, 3/3]
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - id: variance
        uses: Variance-Authority/action@v1
        with:
          config: variance.config.json
          shard: ${{ matrix.shard }}
          comment: 'false'
      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: variance-shard-${{ strategy.job-index }}
          include-hidden-files: true
          path: |
            ${{ steps.variance.outputs.report }}
            .variance/report.suite-part.json
            ${{ steps.variance.outputs.images }}
  merge:
    needs: shard
    if: ${{ always() }}
    runs-on: ubuntu-latest
    permissions:
      contents: write # the published suite index and costs
      pull-requests: write # the comment
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - uses: actions/download-artifact@v8
        with:
          pattern: variance-shard-*
          path: shards
      - uses: Variance-Authority/action@v1
        with:
          config: variance.config.json
          reports: shards/*/report.json
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

`reports` takes one path or glob per line. Given it, the action runs nothing:
it merges the reports with `variance report`, posts one docket, publishes the
suite index and the costs the next build splits by with `variance share
--publish`, and exits 0, 1 or 2 for the whole suite. The publish pushes with
`github-token`, so a checkout with `persist-credentials: false` still
publishes, and nothing writes the token to the clone. The count is written once,
in the matrix. Every report names its shard as `k/n`, so a shard that never
uploaded, a shard given twice, or shards cut two ways exit 2 naming which.
`if: always()` keeps the merge running when a shard found a change and failed
its own job.

How the suite is split is in
[sharding](https://variance-authority.dev/docs/sharding#split-stories-and-routes-the-same-way).

## Sweeping for flakes

`flakes: 'true'` runs `variance run --flakes`: every subject is read twice,
whatever its verdict, so a subject that agrees with its baseline and disagrees
with itself is found before it fails a pull request. The check is red when a
subject read differently twice, even with every verdict green, so leave
`exit-zero-on-changes` off. It costs one
collection per subject and no render, so it runs on a `schedule`, with no pull
request to comment on and the report uploaded as a page:

```yaml
on:
  schedule:
    - cron: '17 3 * * *'

steps:
  - uses: actions/checkout@v7
  - run: npm ci
  - uses: Variance-Authority/action@v1
    with:
      config: variance.config.json
      flakes: 'true'
      comment: 'false'
      report-page: 'true'
```

What a sweep finds and how a flake rate is counted from it is in
[flakiness](https://variance-authority.dev/docs/flakiness).

## Accepting with a tick

`tick-to-accept: 'true'` puts a box in the comment, under `to-accept`. A reviewer
ticks it, and the check runs again and accepts in their name. A tick arrives on
the default branch, outside the pull request's cache and its check, so it needs a
second workflow, which reads none of the pull request's code:

```yaml
name: variance tick
on:
  issue_comment:
    types: [edited]

permissions:
  actions: write # the rerun
  pull-requests: write # the name, in the comment

jobs:
  tick:
    if: github.event.issue.pull_request && github.event.comment.user.type == 'Bot' && github.event.sender.type != 'Bot'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    concurrency:
      group: variance-tick-${{ github.event.comment.id }}
      cancel-in-progress: false
    steps:
      - uses: Variance-Authority/action/tick@v1
```

The person needs write access, and the box must go from unticked to ticked on the
head the pull request is still at. Anything else accepts nothing and says why in
that job's log. The tick waits for a run still going, then reruns it: the rerun
renders that commit again and accepts what it renders, as `accept: true` would.
The approval row names the person where a history is kept, as `by`. The rerun's
intent ends `accepted: ticked by @them`, and its log names them; the name in the
comment lasts until the next run rewrites it, and the comment's edit history keeps
it after that. `actions-cache` is the store this accepts into, so a git or LFS
store leaves the input off. The box needs the docket written by a bot or an app:
with a personal token as `github-token` the comment is a person's, the workflow
skips the edit, and the box does nothing.

## Committing the accepted images

A store committed to git, as files or through git-LFS, accepts by a commit.
`commit-baselines: 'true'` accepts every changed subject and pushes the images to
the branch a person asked about, so turn it on only for a run a person started:

- On a `pull_request` event, the pull request's head branch. The default
  checkout is a merge commit, so check out the head with
  `ref: ${{ github.head_ref }}`.
- On a `workflow_dispatch` of a branch, that branch, which the default checkout
  already is.

Any other run, such as a push or a dispatch on a tag, names no branch to push to,
and the step exits 2 and says so. The job needs `contents: write`, and a token
whose push starts a workflow if the commit should be checked again.

## Deleting a pull request's images

`image-ref-prefix: refs/variance/project` puts the leading change's before and
after on the comment's first screen. The action pushes them to
`refs/variance/project/<project>/images/<head branch>`, which needs
`contents: write`, and they outlive the branch unless a job deletes them when the
pull request closes, merged or not:

```yaml
name: variance images
on:
  pull_request:
    types: [closed]

permissions:
  contents: write # deleting the refs

jobs:
  images:
    runs-on: ubuntu-latest
    steps:
      - uses: Variance-Authority/action/images@v1
        with:
          image-ref-prefix: refs/variance/project
```

It deletes every project's ref for that branch and no other branch's, so
closing `feature` leaves `feature/x`'s images. A fork's pull request is skipped
with a line: its run had a read-only token and pushed nothing.
