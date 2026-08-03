# Setup flows

Five ways to run this, ordered by how much an operator has to stand up. Each rung
is a complete, honest deployment — not a trial version of the next one — and the
list exists so that the question "do I need the service?" has an answer that is
not "it depends".

The rule the ladder is built on: **a rung buys a capability, never a better
verdict.** Where a baseline is kept decides nothing
([ADR-0016](context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)), so
climbing does not make a comparison more correct, and staying low does not make it
less. What changes is what you can *ask*, and who can answer.

| Rung | You stand up | You gain | Ships |
|---|---|---|---|
| 0. Ephemeral | nothing | inspection findings, locale comparison | yes |
| 1. git-LFS | git-lfs | regression, in the repository | yes |
| 2. Shared cache | a CI cache | cold runners stop re-rendering | **no** — [spec 0011](specs/0011-storage-and-cache-primitives.md) |
| 3. Remote baselines | one service, one token | no bot commits, no LFS quota | yes |
| 4. Tribunal | a database and a bucket, two tokens | a review UI, approval without a commit | yes |
| 5. History | a history endpoint | drift across runs | ships, **no caller** — [spec 0002](specs/0002-history-store.md) |

## Rung 0 — ephemeral: nothing is stored

```json
{
  "project": "acme",
  "profile": "chromium",
  "viewport": { "width": 1024, "height": 768, "deviceScaleFactor": 1, "colorScheme": "light" },
  "retention": "ephemeral",
  "subjects": { "kind": "storybook", "index": "storybook-static/index.json", "collector": "collector/index.mjs" },
  "fonts": ["ui-sans-serif/400/normal/sha256-…"],
  "report": ".variance/run.json"
}
```

**You set up** a config and a collector. No store, no bucket, no credentials, no
container, and nothing committed.

**You get** the half of the product that needs no past: nine inspection rules that
read one snapshot and name a component and a file, plus locale comparison. This is
the answer to the usual adoption cost — a visual-regression tool says nothing until
it has a history, and this rung says something on the first run of a fresh
checkout.

**You cannot** detect a regression. `find` returns nothing, always, because there
is no past to return. The config refuses a `baselines` key here rather than
ignoring it, so a file that looks like it stores images and does not cannot exist.

## Rung 1 — git-LFS: baselines in the repository

```json
{
  "retention": "durable",
  "baselines": { "kind": "lfs", "root": ".variance/baselines" }
}
```

**You set up** git-lfs. The store writes its own `.gitattributes` entry, so the
operator's step is installing the filter. Local development can use
`{ "kind": "directory" }` instead — the same layout without the filter — but in CI
a plain directory either bloats the git history with binary blobs or does not
persist between runs, which is why LFS is the floor rather than the fallback.

**You get** regression, reviewed on the pull request. The action fails the check
from the CLI's exit code, posts one comment updated in place that leads with causes
and counts collateral, and uploads the run directory as a build artifact. Approval
is `variance accept` and a commit, or `commit-baselines: true` on the action.

**You cannot:**

- **Approve without writing to the repository.** Approval *is* a commit here, which
  is either the feature or the objection depending on the team.
- **Accept from a fork.** A fork's job has no push credential, so a contributor's
  baseline change needs a maintainer to run it.
- **See images inline.** They travel as a downloadable artifact, not in the comment.
- **Rank the docket by cause.** `before` and `causes` come from the collector, and a
  durable baseline is an image with no document behind it — so ordering falls back
  to area, which this project measured as backwards by 6×
  ([ADR-0021](context/adr/0021-approval-promotes-an-image-that-already-exists.md)).
  Closing this is item 4 of [spec 0011](specs/0011-storage-and-cache-primitives.md).
- **Notice drift across runs.** Eleven separately-correct 2px approvals are eleven
  green builds and a 22px change nobody ever sees. Only rung 5 answers this, and
  it is the one thing no amount of care at this rung substitutes for.

## Rung 2 — a shared render cache

**Not built.** Recorded here because the gap is easy to mistake for a
misconfiguration.

A durable store is already a render cache, and for LFS it is deliberately kept
*outside* the work tree — a cache committed through the LFS filter would gain an
entry per edit and spend the quota bought for baselines on images nobody will look
at. That is right, and it means the cache is **local to a machine**. A fresh CI
runner starts cold and re-renders every subject, every time, even though the
baselines came down with the checkout.

What is missing is not a backend but a seam. `cached`/`cache` are welded into
`RasterStore`, whose contract is that a failure must throw — correct for a
baseline, where a lost lookup destroys the thing being compared against, and wrong
for a cache, where the right answer to every failure is to re-render. Splitting
`RenderCache` out with the never-throws rule is what makes a CI cache, an S3
bucket, or the tribunal a configuration choice instead of a fork.

## Rung 3 — remote baselines

```json
{
  "retention": "durable",
  "baselines": { "kind": "remote", "endpoint": "https://variance.internal", "token": "…" }
}
```

**You set up** one deployment serving five paths, and one token in CI.

**You get** baselines out of the repository. No bot commits on branches, no LFS
bandwidth quota, and a corpus that can grow past what anyone wants in a clone.
`variance accept` writes through to the store, so approval stops being a commit.

**You cannot** review anywhere but the pull request. This rung moves where bytes
live and changes nothing about who decides.

## Rung 4 — tribunal: the review loop

**You set up** a database, a bucket, and **two** tokens — one for ingest, one for
review — plus a mounting adapter that decides which capability a request gets.

The two-token rule is not defence in depth. Approving promotes a baseline every
future run is compared against, so one token spanning both means anything that can
read a build log can approve a regression. Two equal values are refused at
construction, because a deployment with one secret in two fields satisfies every
check in the router and nothing in any request would show it
([ADR-0022](context/adr/0022-deciding-is-not-writing.md)).

**You get** a surface: builds, a docket that leads with causes, region overlays,
approve and reject as recorded decisions, and retention sweeps. Approval promotes
an artifact the run already produced — nothing in the review path renders, because
a surface that can render can record a baseline nobody ever looked at
([ADR-0021](context/adr/0021-approval-promotes-an-image-that-already-exists.md)).

**You cannot** hand either token to a browser. The review token promotes
baselines, so the adapter keeps both server-side and attaches one per request —
which makes the adapter, not the token, the gate. `authorize` therefore has no
default, and an operator who wants an open surface writes that line in their own
repository where the next reader can see it.

## Rung 5 — history: drift across runs

**Ships, with no caller.** The rows, the drift arithmetic, two backends and the
wire all exist and are tested; nothing writes to them from a run, and the contract
has no read that would let one. See [spec 0002](specs/0002-history-store.md).

Worth stating anyway, because it is the only rung that answers a question the
others structurally cannot. Every rung below compares two things. A sum across
approvals is not a comparison, so no threshold catches it and no reviewer sees it:
each of the eleven 2px changes was correctly approved and the twelfth run still
compares against the eleventh. This is the capability the service exists for, and
the honest statement of the ladder is that rungs 1 through 4 are conveniences over
each other, while rung 5 is a different question.

## Choosing

- **Trying it, or you want the a11y half** — rung 0. It costs a config file.
- **A team on one repository** — rung 1. Baselines in the repo, review on the PR.
  Most projects should stop here.
- **Bot commits are unacceptable, or the corpus is large** — rung 3.
- **Reviewers who are not the people running CI** — rung 4.
- **You have been approving small changes for a year** — rung 5 is the only thing
  that will tell you what that added up to.
