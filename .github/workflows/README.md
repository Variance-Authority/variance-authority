# Workflows

Five workflow files live here. Three of them are recipes, meant to be copied
into your own repository and edited. Each is a complete answer to a different
question, and every decision inside them is commented as a decision — including
the ones that are wrong for somebody else's repository. They all shell out to
one tool: `@variance-authority/cli`, a devDependency, invoked as
`npx variance <command>`.

A **subject** is one named UI state observed under an id you choose — one
Storybook story, one route at one viewport, one component mounted in a test. It
is the unit these files count, shard and gate on.

If you copy one file, change two things: the `--config` path, so it points at
your own `variance.config.json`, and the step that builds the thing being
observed (here, a Storybook). Copy [`../actions/variance`](../actions/variance)
alongside `variance.yml` and `variance-shards.yml` — it is a composite action in
this repository, not one published to the Marketplace, so `uses:
./.github/actions/variance` only resolves if the directory came with the file.

| File | Asks | Costs |
|---|---|---|
| [`variance.yml`](variance.yml) | *is this change real* | one collection and one render per changed subject |
| [`variance-sweep.yml`](variance-sweep.yml) | *which subject would flake tomorrow* | every subject read twice, and **nothing rendered** |
| [`variance-shards.yml`](variance-shards.yml) | *is this change real, across a suite too big for one job* | the gate's cost, divided by the slowest shard |

*Collection* is reading the live page; *render* is repainting that reading into
an image. [`docs/stabilization.md`](../../docs/stabilization.md) has both.

The other two files here, [`check.yml`](check.yml) and
[`release.yml`](release.yml), are this repository's own build and publish. They
are not recipes and observe nothing.

Here, the gate runs on every pull request and on every push to `main`, the sweep
nightly, and the shards on demand only — sharding twelve subjects across three
installs saves nothing, and the shards find their pull-request comment by the
same hidden HTML marker the gate uses, so on the same event the two would
overwrite each other.

## How the CLI reaches the runner

By `yarn install` — it is a dependency of the project being observed, not
something the workflow fetches. The composite action's `command` input defaults
to `npx --no-install variance`, which is what your copy should use:

```yaml
- uses: ./.github/actions/variance
  with:
    config: variance.config.json
    profile: chromium
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

The three files here pass `command: node packages/cli/dist/bin.js` instead,
because this repository builds the CLI from source and has no published copy to
resolve.

Every job runs inside `mcr.microsoft.com/playwright:v1.62.1-noble`. An approved
image is keyed by the identity of the machine that painted it, so a moving runner
image means baselines invalidated on somebody else's schedule. Pin the image, and
put its tag in the cache key.

## Getting a first baseline

The first run of any subject reports `new` and exits `1`. An image nobody has
approved is not a pass, and nothing in these files promotes one on its own.

To end that state here: run `variance.yml` from the Actions tab on `main`, tick
`accept: true`, and let it finish. That run executes
`variance run --exit-zero-on-changes`, then `variance accept --all`, compares
again, and saves the baseline store to the runner cache. Every run after it
restores that store and compares against it.

`accept --all` promotes every candidate the run produced — both the subjects
nobody has ever reviewed and the subjects whose component just changed. The CLI
cannot yet tell those two apart, so a job that ran it on a schedule or a push
would promote the regression it was added to catch. That is why every accept is
a person's act. Read the report from the run that went red first.

## Accepting a change on a pull request

A pull request that moves pixels is red, and its comment links the report. To
accept, add the `variance: accept` label. That starts a run on the pull request
that promotes what it rendered, compares again, and saves the store into the
pull request's own cache scope, which its later runs read before `main`'s. The
run takes the label off again, so a later push that moves pixels needs a new
label, and the timeline keeps who accepted and when.

Merging carries the acceptance to `main`. The push run finds the merged pull
request, reads its `variance` check at its head commit, and when that was green
it promotes the same pixels on `main`, so nobody accepts twice. It does so only
when `main` itself was green before the merge: a red `main` already held pixels
nobody accepted, and one render cannot separate them from the reviewed ones. In
that case `main` stays red until somebody dispatches an accept there, and the
run's log says why.

## The pictures in the comment

The comment shows the leading cause's before and after on its first screen, and
each further cause's pair inside its fold. The action pushes the report's before
and after images to a branch named for the pull request's, with `--variance`
after it: one commit with no parent, replaced by every run that finds a change.
The comment links that commit rather than the branch, so an image cache never
shows a previous run's pictures. When the pull request closes, merged or not, a
second job deletes the branch.

That branch is why `variance.yml` asks for `contents: write`. Anyone who can
read the repository can read it. A pull request from a fork runs with a
read-only token, so the push is refused, the step warns, and the comment arrives
without pictures. To turn this off in your copy, drop the `image-branch` input
and the `images-cleanup` job.

## Where the baselines live here

`.variance/` is git-ignored: a report changes whenever the document does, so
reports beside their images would make a diff out of every edit that moved no
pixel. The store is the runner's cache instead, written by `variance.yml` only
on a run that accepts, and only after a comparison against it came back green.

A pull request and a push to `main` are both gates, both red when a subject
moved. A cache key that does not match the renderer cannot produce a wrong diff:
a baseline whose identity differs from the run's is reported `incomparable` and
no image is produced, so the worst a stale key does is make a check loud.

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
::error::variance found changes that need review; the docket is in the pull request comment.
::error::variance could not run (exit 2); see the variance run step.
```

What differs is what reaching `1` *means*:

- In the gate, a subject changed.
- In the sweep, a subject did not read the same way twice — **even when every
  verdict is green**. That is the finding, not a break.
- In the shards, the merged suite changed, or a subject that every shard filtered
  out is recorded as `failed`. A shard's own exit code is about its slice and is
  never the check's colour.

## Two things none of these files does

**Post anything you did not configure.** The only network call any of them makes
beyond the checkout is to the GitHub API of the instance already running the job,
with the token the workflow passed in. No command in the CLI posts anywhere;
[`../actions/variance`](../actions/variance) is what sends the body, and it is
bash around the same binary.

**Approve on the branch being reviewed.** `commit-baselines` is off in both files
that offer it, and the comments say why at the point where somebody would turn it
on: a run that accepts what it just found has stopped being a gate. Turning it on
also makes a bot push to the contributor's branch, which a fork's read-only token
cannot do at all.
