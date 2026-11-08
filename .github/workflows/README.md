# Workflows

The workflow files here are all this repository's own. Three
run variance over this repository's subjects, each answering a different
question, through the action as it stands in this checkout,
`./.github/actions/variance`. A release publishes that action as
[`Variance-Authority/action`](https://github.com/Variance-Authority/action), and
the [CLI reference](../../packages/cli/README.md#run-it-in-ci) shows an adopter's
step. All three shell out to one tool: `@variance-authority/cli`, invoked as
`variance <command>`.

A **subject** is one named UI state observed under an id you choose — one
Storybook story, one route at one viewport, one component mounted in a test. It
is the unit these files count, shard and gate on.

| File | Asks | Costs |
|---|---|---|
| [`variance.yml`](variance.yml) | *is this change real* | one collection and one render per changed subject |
| [`variance-sweep.yml`](variance-sweep.yml) | *which subject would flake tomorrow* | every subject read twice, and **nothing rendered** |
| [`variance-shards.yml`](variance-shards.yml) | *is this change real, across a suite too big for one job* | the gate's cost, divided by the slowest shard |

*Collection* is reading the live page; *render* is repainting that reading into
an image. [`docs/stabilization.md`](../../docs/stabilization.md) has both.

Four other files here, [`check.yml`](check.yml),
[`release.yml`](release.yml), [`outer-loop.yml`](outer-loop.yml) and
[`ci-image.yml`](ci-image.yml), are this repository's build, publish, end-to-end
test and the image its containerized jobs run in.
`outer-loop.yml` has [its own section](#the-outer-loop). On a pull request,
`check.yml` uses the recording `main` saved to select the tests the change
reached. It compares the predicted time of that selection in one job with a
sharded full suite and runs the cheaper option.
A push to `main` runs the whole suite. It then posts two comments on the pull request, each under its own
marker so neither overwrites the gate's: `variance review` over the suite's
recording, and `variance coverage` against the record `main` saved. A merge
group runs `plan` and `queue` in place of those jobs: lint and `yarn check` in
one job, and the tests within two imports of what the group changed in the
others, in as many shards per slice as `variance shards` counts them worth. It
posts nothing.

Here, the gate runs on every pull request and on every push to `main`, the sweep
nightly, and the shards on demand only — sharding thirteen subjects across two
installs saves nothing, and the shards find their pull-request comment by the
same hidden HTML marker the gate uses, because the marker names the config's
`project` and the two run one config, so on the same event the two would
overwrite each other. The gate runs three configs, each its own check with its
own comment and its own box to tick: the case's Storybook, and a matrix over
this project's own surfaces, the review surface's Storybook and the site. The
site's check photographs on a pull request only when the change reaches what
the site is built from or photographed with, which `tools/site-reach.mjs`
reads out of the checkout; otherwise it ends green and its summary says why.
It reports rather than blocks: a change it finds is a warning on a green check,
with its docket and report as on the other two, and its box still accepts it. It turns red when the run did not happen, when a subject
could not be observed, an observation errored or the report cannot be read, and
when an accept the comparison after it did not hold. The action's
`exit-zero-on-changes` input does that for any job. Off a pull request the same
row also builds everything again under `variance job`, and the record of what it
read and wrote is the run's `site-job-record` artifact.
Two more jobs run the case's Storybook under the other two ways of keeping a
baseline, each with its own config and comment: `lfs` commits the
baselines to the pull request's branch through git-LFS, and `tribunal-service`
deploys this commit's review service to workers.dev and pushes the build to it.
That one needs the `CLOUDFLARE_API_TOKEN` secret and fails without it.

`check.yml` runs one job per harness — the repository's rules, with the carry
contract as one of their steps, the timed measurements, and the vitest suite —
and a `check` job that turns their results into the one check a branch rule
names. In a merge group `plan` and `queue`
replace the harness jobs, and `check` still runs, reading only their results.

## How the CLI reaches the runner

By `yarn install` — it is a dependency of the project being observed, not
something the workflow fetches. The composite action's `command` input defaults
to `npx --no-install variance`, the CLI the project installed. The three files
here pass `command: node packages/cli/dist/bin.js` instead, because this
repository builds the CLI from source and has no published one to resolve.

Every job that observes runs inside the CI image, `mcr.microsoft.com/playwright:v1.64.1-noble`
with this repository's tools, built from
[`docker/ci.Dockerfile`](../../docker/ci.Dockerfile) and tagged with that file's
git blob id, so the tag never moves. An approved
image is keyed by the identity of the machine that painted it, so a moving runner
image means baselines invalidated on somebody else's schedule. Pin the image.

No workflow here names a path the config names, or builds a cache key.
`variance carry restore --format github` prints both as step outputs, from
the config's `carry` fields, and the steps hand them to `actions/cache`:

```yaml
- id: carry
  run: npx --no-install variance carry restore --config variance.config.json --format github >> "$GITHUB_OUTPUT"
- if: steps.carry.outputs.baselines-key != ''
  uses: actions/cache/restore@v6
  with:
    path: ${{ steps.carry.outputs.baselines-path }}
    key: ${{ steps.carry.outputs.baselines-key }}
    restore-keys: ${{ steps.carry.outputs.baselines-restore-keys }}
```

The action does this itself, so a job that uses it names the config and
nothing else.

## Who accepts a change

Accepting a change writes a new baseline, so where the baselines live decides
who accepts and how.
[`docs/placement.md`](../../docs/placement.md#who-accepts-a-change) compares the
three arrangements. This repository runs the CI cache for the case and its own
surfaces, and a committed store in the `lfs` job. This is what each one needs:

| store | `baselines` in the config | the baseline root | secret |
|---|---|---|---|
| CI cache | `directory`, `carry: actions-cache` | ignored by git | none |
| git | `directory` or `lfs` | tracked | `VARIANCE_PUSH_TOKEN` |
| Tribunal | `remote`, and a `review` section | not in the work tree | `VARIANCE_INGEST_TOKEN` |

- **The CI cache** is what the rest of this page describes: a tick in the
  docket accepts on a pull request, a dispatch with `accept` accepts on its
  branch, the store is saved to the runner's cache, and every push to `main`
  accepts what `main` renders.
- **git**, the `lfs` job, checks out the pull request's branch instead of the
  merge, skips the cache, and turns on the action's `commit-baselines` for a
  dispatch with `accept` on that branch. That run stays red, because it found
  the change it then committed. The push starts the run that checks the new
  commit, which is why the token has to be one whose push starts a workflow.
  On `main` a change is a warning, since the images merged with the code. For
  `lfs`, install git-lfs in a step before the checkout, leave the checkout's
  `lfs` off, and run `git lfs install --local --skip-smudge` after it: the run
  fetches the images it compares, and a commit stores pointers.
- **Tribunal** skips the cache and sends every run to the service with
  `variance push`, red or green. The comment sends the reviewer to the
  service's page, where each subject is approved or rejected.

## Getting a first baseline

The first run of any subject reports `new`, and the comment lists it as NEW,
apart from anything that needs review. `new` does not turn the check red —
nothing moved — but an image nobody has approved is not a pass either.

With the CI cache, the push to `main` that lands a subject's config records its
baseline: every push to `main` accepts what `main` renders, as [Accepting a
change on a pull request](#accepting-a-change-on-a-pull-request) describes. To
record one without waiting for a push, run `variance.yml` from the Actions tab
on `main`, tick `accept: true`, and let it finish. Either run executes
`variance run --exit-zero-on-changes`, then `variance accept --all`, compares
again, and saves the baseline store to the runner cache. Every run after it
restores that store and compares against it.

`accept --all` promotes every candidate the run produced — both the subjects
nobody has ever reviewed and the subjects whose component just changed. The CLI
cannot yet tell those two apart, so a job that ran it on a schedule would
promote the regression it was added to catch. That is why every accept is a
person's act: a tick, a dispatch, or a merge or push to `main`, each made by
somebody who could read the report first.

## Accepting a change on a pull request

A pull request that moves pixels is red, and its comment links the report. To
accept, tick the box the docket carries. Ticking it starts
`variance-tick.yml` on the default branch, which reads no code from the pull
request. It asks the API whether the person has write access, replaces the box
with their name, and reruns the check. The rerun finds that name, promotes what
it rendered, compares again, and saves the store into the pull request's own
cache scope, which its later runs read before `main`'s, and says who in its log. A rerun replays the commit its run
started on and renders it again, so what it accepts is that render. A tick from
anyone without write access, on a head the pull request has left, or that takes
the mark off accepts nothing and says why in the tick's log. A push brings a new box for the
new head, and the rewritten comment drops the name: the accepting run's log, the
comment's edit history and, where a history is kept, the approval row hold it.
The box is on the CI cache's checks, since what it accepts into is the runner's
cache; the `lfs` job's docket names the dispatch instead.

Merging is an accept too. A pull request is where a change is judged, and what
lands on `main` is `main`: every push to `main` promotes what it renders,
whatever the pull request's check said, whether it finished, and whether `main`
was green before. Like the tick's run, it compares again and keeps the store
whatever that finds: a subject still unstable, an observation that errored or a subject not
observed leaves `main` red and names it, and every other subject's baseline is
kept all the same. A pull request that holds no accept of its own then compares
against the newest push to `main`.

Runs on `main` wait for each other instead of cancelling each other, so each
run's store is saved after the one before it and the newest commit's render is
the last one kept. GitHub keeps only one waiting run, so of three merges close
together the middle one may never run, and a rebase merge runs only its last
commit. That costs nothing: the newest commit renders everything the skipped one
did.

## The pictures in the comment

The comment shows the leading cause's change on its first screen, and each
further cause's inside its fold. A change is one picture at its own size: each
of the largest changed regions with the rows around it, as before, after and the
difference, top to bottom. A subject with no region to crop shows its whole
before and after instead. The action pushes those images from the report to
`refs/variance/project/<project>/images/<branch>`, named for
the config's `project` and the pull request's branch, so each job's comment
links its own pictures. `<project>` is spelled as `variance carry` prints it,
one path segment whatever the project holds. The ref is one commit with no
parent, replaced by every run that finds a change. It is not a branch, so a
clone does not fetch it and the branch list does not show it. The comment links
the commit rather than the ref, so an image cache never shows a previous run's
pictures. When the pull request closes, merged or not, a second job deletes
every project's ref for the branch with `Variance-Authority/action/images`.

That ref and the report's share lines below are why `variance.yml` asks for
`contents: write`. Anyone who can read the repository can read the images. A
pull request from a fork runs with a read-only token, so the push is refused,
the step warns, and the comment arrives without pictures. Without the
`image-ref-prefix` input the action pushes no ref, and the `images-cleanup` job
has nothing to delete.

## Where the baselines live here

`.variance/` is git-ignored: a report changes whenever the document does, so
reports beside their images would make a diff out of every edit that moved no
pixel. The store is the runner's cache instead, which the case's config declares
with `baselines.carry: actions-cache`. `variance.yml` writes it only on a run
that accepts.

A pull request and a push to `main` are both gates, both red when a subject
moved. The cache key does not name the renderer, because the record beside
each image already does: a baseline whose identity differs from the run's is compared
with the moved identity named as the cause, so the worst an image bump does is
make a check loud until the next accept.

## Where the report lives here

The report is carried by the share, as the case's config declares with
`report.carry: share` and `share: { "kind": "git" }`. After the gate,
`variance share --publish` writes it to a ref under `refs/variance/`: the
mainline's on a push to `main`, and the branch's on a pull request. Any
checkout that can fetch `main` can read the report `main` last published, and
compare a local edit against it, without running a browser. A pull request from
a fork publishes nothing, because its token cannot push.

The three are not a ladder. A repository can run all of them, and most that shard
also want the sweep — the sweep asks something no verdict can reach, and sharding
changes only where the gate's work happens.

## What varies between them, and what does not

These files vary along two axes: **when a run is triggered**, and **what its exit
code is allowed to mean**. Everything else a run does is chosen in your config,
and none of it changes here:

- where a subject comes from — [`docs/surface.md`](../../docs/surface.md)
- where a baseline lives — [`docs/placement.md`](../../docs/placement.md)
- where the renderer runs — [`docs/flows.md`](../../docs/flows.md)

Those three are chosen independently of each other and of these files. A sweep of
a Storybook against remote baselines and a sharded gate over a URL list against
git-LFS are the same two files with different configs, not two different
pipelines.

## The exit code is the interface, and it means the same thing in all three

```
0  nothing needs review
1  changes need review
2  the run did not happen as configured
```

A verdict and a crash never share a code, which is why none of these files greps
the CLI's output and why `|| true` appears in none of them — it would swallow `2`
and post a green tick over a run whose browser never launched. `run` and `report`
take `--exit-zero-on-changes` for a job that reports rather than blocks; it
suppresses `1` only, and says so on stderr.

Each file ends by turning that integer into a line in the job log:

```
nothing needs review.
::error::variance found changes that need review; the docket is in the pull request comment at https://github.com/owner/repo/pull/7#issuecomment-1
::error::variance could not run (exit 2); see the variance run step.
```

The address comes from the step that posted the comment, so a run whose comment
GitHub refused, such as a fork's, names the report instead. The comment's heading
names the config's `project`: the `tribunal` and `site` checks each post one, and
each is a run in this repository, accepted by its box. The check called
`tribunal` observes that package's Storybook, and no review service holds it.

What differs is what reaching `1` *means*:

- In the gate, a subject changed.
- In the sweep, a subject did not read the same way twice — **even when every
  verdict is green**. That is the finding, not a break.
- In the shards, the merged suite changed, or a subject every shard left to
  another is recorded as `failed`. A shard's own exit code is about its slice and is
  never the check's colour.

## The outer loop

Every test in this repository stops at the GitHub API. `outer-loop.yml` is the
one that goes through it: every Monday it drives each review flow the way a
consumer meets it, in the example repository that carries it.

| Flow | Example | The accept |
|---|---|---|
| `cache` | `Variance-Authority/example-storybook` | the `variance: accept` label; the tick is not driven here, since it needs the example's own `variance-tick.yml` |
| `lfs` | `Variance-Authority/example-static-site` | the label, whose run commits the images to the branch |
| `tribunal` | `Variance-Authority/example-tribunal` | none: the flow ends at the build on the deployment |

For each flow it opens two pull requests there: one that changes what a subject
renders, and a control that changes nothing any subject reaches. It proves:

- the change's `variance` check is red because a change needs review, and the
  docket names the changed subject;
- the control is green and nothing is pushed to it;
- on `example-storybook`, the "What this change might do" and test evidence
  comments name the one test that covers the changed file, and the test run
  selected only it;
- on `example-tribunal`, the deployment holds exactly one build for the
  change's branch, listing the four changed product-card subjects;
- after the label on `example-storybook` and `example-static-site` the check is
  green, and on `example-static-site` the commit the label made touches only
  the changed page's baseline image and its report.

Then it closes both pull requests unmerged and deletes their branches, whatever
happened.

It never approves and never merges. The two labels land only on a pull request
it is about to close: the cache flow's accept saves into that pull request's own
cache scope, which no other branch reads, and the LFS flow's accept commits to
that pull request's branch. An approval on the tribunal is not scoped to a
branch: it replaces the baseline `main` and every other branch compare against,
which is a merge, so the tribunal flow leaves its check red and its build
unreviewed. The build stays on the deployment until something calls its
retention sweep, `POST /review/sweep`.

These label accepts are made by a job, not a person, and they are the only ones
in this repository that are. The expectations live in
[`../scripts/outer-loop/flows.mjs`](../scripts/outer-loop/flows.mjs), and
`tools/outer-loop.check.ts` runs the script against a local GitHub that answers
the way the examples do.

The examples pin a released action, so this reads a release, not `main`: it
fails after a release reaches an example, or after an example changes, never on
a pull request here.

Every wait is bounded, and so is the flow as a whole: all its waits share twice
one wait's minutes. The flow step's timeout is the longest flow's budget plus
ten minutes for requests, and the job gives the settle step ten minutes after it. A failing flow, or one its
timeout stopped, opens an issue labelled `outer-loop-e2e` here, or comments on
the one already open, and the next run that passes closes it. A dispatched run
somebody cancels files nothing. To run it on demand, for one flow or all three:

```bash
gh workflow run outer-loop.yml -f flow=tribunal
```

It reaches the examples with the `VARIANCE_PUSH_TOKEN` secret, and reads the
tribunal deployment without a token. Without that secret a flow fails before it
opens anything, naming the secret and what it has to be allowed.

## Two things none of these files does

**Post anything you did not configure.** Beyond the checkout, they call the
GitHub API of the instance already running the job, with the token the workflow
passed in, and in the `tribunal` job the service its config names. No command in the CLI posts anywhere;
[`../actions/variance`](../actions/variance) is what sends the body, and it is
bash around the same binary.

**Accept without a person.** Every accept is a tick, a dispatch, a push to
`main`, or a decision on the service. The outer loop's label accepts in the
examples are the one exception: they land only on pull requests it opened to
close. `commit-baselines` is on only in `variance.yml`'s `lfs` job, and only
for a dispatch with `accept`. On every run it would accept what the run just found, and a check that
does that has stopped being a gate.
