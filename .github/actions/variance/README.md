# Variance Authority action

This action runs the `variance` CLI your project already installed over a pull
request. The CLI's exit code sets the check's colour. Around that run, the
action does the three things a command line cannot do for itself:

- It posts the result to the pull request as one comment, updated in place.
- It restores and saves the baselines the Actions cache carries.
- It accepts a change on a run a person asked for, such as one a label or a
  [tick](#accepting-with-a-tick) started.

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
