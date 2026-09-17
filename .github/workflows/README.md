# Workflows

Three recipes, meant to be copied and edited. Each one is a complete answer to a
different question, and every decision inside them is commented as a decision —
including the ones that are wrong for somebody else's repository.

They also run here. The subject is [`cases/storybook-case`](../../cases/storybook-case)
— twelve stories and a Storybook each job builds — which is a fixture rather than
this project's own interface, and [`site/`](../../site) still has no subject of
any kind.

| File | Asks | Costs |
|---|---|---|
| [`variance.yml`](variance.yml) | *is this change real* | one collection and one paint per changed subject |
| [`variance-sweep.yml`](variance-sweep.yml) | *which subject would flake tomorrow* | one collection per subject, and **never a paint** |
| [`variance-shards.yml`](variance-shards.yml) | *is this change real, across a suite too big for one job* | the gate's cost, divided by the slowest shard |

Here, the first runs on every pull request and on every push to `main`, the second
nightly, and the third on demand only — it would shard twelve subjects across
three installs to save nothing, and it renders its docket with the same marker the
gate does, so on the same event the two would fight over one comment.

## Where the baselines live here

`.variance/` is ignored, on purpose: a record changes whenever the document does,
so records beside their images would make a diff out of every edit that moved no
pixel. The store is the runner's cache instead, and one thing writes it:
`variance.yml`, dispatched by hand with `accept: true`.

Every run restores it and none of them promotes anything. A pull request and a
push to `main` are both gates, both red when a subject moved, and the way to
answer a red one is to look at the docket and then dispatch an accept. A cache key that does not match the renderer cannot
produce a wrong diff: a baseline whose identity differs from the run's is reported
`incomparable` and no image is produced (ADR-0011), so the worst a stale key does
is make a check loud.

They are not a ladder. A repository can run all three, and most that run the
third also want the second — the sweep asks something no verdict can reach, and
sharding changes only where the gate's work happens.

## What varies between them, and what does not

These files vary along two axes: **when a run is triggered**, and **what its exit
code is allowed to mean**. Everything else a run does is chosen elsewhere and
none of it changes here:

- where a subject comes from — [`docs/surface.md`](../../docs/surface.md)
- where a baseline lives — [`docs/flows.md`](../../docs/flows.md)
- where the renderer runs — [`docs/flows.md`](../../docs/flows.md), the short
  ladder at the bottom

Those three are chosen independently of each other and of these files, because
[where a baseline is kept decides nothing](../../docs/context/adr/0016-where-a-baseline-is-kept-decides-nothing.md).
So a sweep of a Storybook against remote baselines and a sharded gate over a URL
list against git-LFS are the same two files with different configs, not two
different pipelines.

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
suppresses `1` only, and says on stderr that it did.

What differs is what reaching `1` *means*:

- In the gate, a subject changed.
- In the sweep, a subject did not read the same way twice — **even when every
  verdict is green**. That is the finding, not a break.
- In the shards, the merged suite changed, or a subject that every shard filtered
  out was promoted to `failed`. A shard's own exit code is about its slice and is
  never the check's colour.

## Two things none of these files does

**Post anything the operator did not configure.** The only network call any of
them makes beyond the checkout is to the GitHub API of the instance already
running the job, with the token the workflow passed in. No command in the CLI
posts anywhere; [`../actions/variance`](../actions/variance) is what sends the
body, and it is bash around the same binary.

**Approve on the branch being reviewed.** `commit-baselines` is off in both files
that offer it, and the comments say why at the point where somebody would turn it
on: a run that accepts what it just found has stopped being a gate. Nothing here
promotes a baseline on a pull request.

Nor anywhere else automatically. `variance.yml` promotes only when a person
dispatches it with `accept: true`, and that is not a convenience: `accept --all`
cannot yet tell a subject nobody has ever reviewed from a subject whose component
just changed (spec 0023), so a job that ran it on a schedule or a push would
promote the regression it was added to catch. Until that distinction exists in the command, the person is the
distinction.
