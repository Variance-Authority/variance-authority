# Variance Authority action

This action runs the `variance` CLI your project already installed over a pull
request. The CLI's exit code sets the check's colour. Around that run, the
action does the three things a command line cannot do for itself:

- It posts the result to the pull request as one comment, updated in place.
- It restores and saves the baselines the Actions cache carries.
- It accepts a change on a run a person asked for, such as one a label or a
  [tick](#accepting-with-a-tick) started.

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

`Variance-Authority/action/review` runs `variance review --coverage` after your
tests and posts what it wrote as one comment of its own, updated in place on
every push. The comment stays beside a docket and never replaces one. It needs
no `config`: it reads the record your tests left, so `npm test` has to run under
[the recorder](https://variance-authority.dev/docs/test-an-edit), for a suite the root `variance.config.json` declares with
`"suites": { "unit": { "kind": "unit", "carry": "actions-cache" } }`.

```yaml
permissions:
  contents: read # the checkout: a declared block sets the rest to none
  pull-requests: write # the comment

steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 0 # the review reads the change from where it starts
  - run: npm ci
  - id: carry
    run: npx variance carry restore --format github >> "$GITHUB_OUTPUT"
  - uses: actions/cache/restore@v6
    with:
      path: ${{ steps.carry.outputs.suite-unit-path }}
      key: ${{ steps.carry.outputs.suite-unit-key }}
      restore-keys: ${{ steps.carry.outputs.suite-unit-restore-keys }}
  - id: take # sets the mainline's record aside before your tests write over it
    run: npx variance carry take --format github >> "$GITHUB_OUTPUT"
  - run: npm test
  - if: ${{ !cancelled() }}
    uses: Variance-Authority/action/review@v1
    with:
      suite: unit
      against: ${{ steps.take.outputs.against-unit }}
  - id: save
    if: ${{ !cancelled() }}
    run: npx variance carry save --format github >> "$GITHUB_OUTPUT"
  - if: steps.save.outputs.suite-unit-key != ''
    uses: actions/cache/save@v6
    with:
      path: ${{ steps.save.outputs.suite-unit-path }}
      key: ${{ steps.save.outputs.suite-unit-key }}
```

The cache steps are what the comment compares with. `carry save` prints a key
only on a push to a mainline, so the mainline's run saves the record and a pull
request restores it.

Coverage has two bases. `against` is compared with the suite `suite` names, and
only that suite: without `suite` the coverage rows do not read it. Otherwise a suite
declared with `"carry": "share"` is compared with the record its mainline
published through [the share](https://variance-authority.dev/docs/sharing), and
needs neither the cache steps nor `against`. Any other suite, and any suite
before its mainline has a record, reads "No baseline available; change cannot be
compared" on every comment.

The review needs the commit the change starts from and a diff from it, so check
out every commit: `fetch-depth: 0`, with `filter: tree:0` to leave the trees out.
A clone that lacks that commit fails the step, and the CLI says what to fetch.
With several suites declared, `suite` is required too. On a push there is no pull request, so the review reaches the step summary alone, and a repository's first commit has no start to review from.

A review finds nothing a person must approve, so it has no verdict and no
outputs. The step fails when no review could be written, and when the comment
could not be posted: a 500 from GitHub fails it. A token that cannot write only
warns, and the review is still in the step summary. A failed review posts
nothing, so the comment from the last good push stays in place. A project with a
surface as well runs both actions.

Each changed function no case covered in a run of the change is also marked in
the diff, as a warning on the first lines the change wrote in it. GitHub shows ten
of a step's warnings, so a longer list ends with a note of how many it left out.
A record older than the change marks nothing: it has not run what the change
wrote. With several suites, a suite that has not run the change answers for
nothing, so a function only that suite reaches is marked until it does.

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
renders that commit again and accepts what it renders, as the label's run does.
The approval row names the person where a history is kept, as `by`. The rerun's
intent ends `accepted: ticked by @them`, and its log names them; the name in the
comment lasts until the next run rewrites it, and the comment's edit history keeps
it after that. `actions-cache` is the store this accepts into, so a git or LFS
store leaves the input off. The box needs the docket written by a bot or an app:
with a personal token as `github-token` the comment is a person's, the workflow
skips the edit, and the box does nothing.
