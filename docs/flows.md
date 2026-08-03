# Setup flows

Six ways to run this, ordered by how much an operator has to stand up. Each rung
is a complete, honest deployment — not a trial version of the next one — and the
list exists so that the question "do I need the service?" has an answer that is
not "it depends".

This is one of two axes. It decides **where a baseline lives**; it says nothing
about **how a subject arrives**, which is [`surface.md`](surface.md) and is chosen
independently.

The rule the ladder is built on: **a rung buys a capability, never a better
verdict.** Where a baseline is kept decides nothing
([ADR-0016](context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)), so
climbing does not make a comparison more correct, and staying low does not make it
less. What changes is what you can *ask*, and who can answer.

| Rung | You stand up | You gain | Ships |
|---|---|---|---|
| 0. Ephemeral | nothing — but the collector must supply **both** revisions | regression with no stored artifact and no comparability question; inspection findings | yes |
| 1. git-LFS | git-lfs | regression, in the repository | yes |
| 2. Shared cache | a CI cache | cold runners stop re-rendering; documents, so the docket ranks by cause | **no** — [spec 0011](specs/0011-storage-and-cache-primitives.md) |
| 3. Remote baselines | one service, one token | no bot commits, no LFS quota | yes |
| 4. Tribunal | a database and a bucket, two tokens | a review UI, approval without a commit | the surface ships; **nothing posts a build to it** |
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

**Corrected 2026-08-03, and the correction reverses this rung.** It previously
read "**You set up** a config and a collector … **You cannot** detect a
regression. `find` returns nothing, always, because there is no past to return."
Both halves were wrong, in opposite directions, and together they described the
wrong rung entirely. What follows is what the code does.

**You set up** a config, and a collector that can produce **two documents per
subject** — the revision under test and the one to compare against. No store, no
bucket, no credentials, no container, nothing committed. That is genuinely no
infrastructure, and it is not no work: a collector that can mount only the current
checkout does not satisfy this rung. Every subject it cannot supply a `before` for
is recorded `failed` with that as the reason (`packages/cli/src/commands/run.ts:805`),
so the run reports nothing about it rather than reporting it clean.

**You get regression detection — this is a comparison rung, and the cheapest one.**
Both images are rendered now, by one renderer, and discarded, so the machine
cancels out *by construction*: no container, no pinned runner, no comparability
question ([ADR-0011](context/adr/0011-durable-and-ephemeral-retention.md)).
Nothing calls `find` here because there is no store to call it on, which is a
statement about where the other image came from and not about whether there is
one.

**And you get the lenses that need no past**: nine inspection rules that read one
snapshot and name a component and a file, attached to the same record as the
comparison. This rung is the cleanest demonstration that **the image is not the
unit of review** — nothing is stored and there is still something to decide about,
because a finding resolves to a component, a file and a reason by the same
provenance chain a ranked region does. The pixels are one lens over the artifact
and accessibility is another; what a reviewer is handed is the union.

**You cannot** compare against anything this run did not render. That is the trade:
the machine stops mattering, and in exchange the *other revision* becomes the
collector's problem — usually a second checkout or a build of both revisions,
which is where the infrastructure this rung saves reappears as build time. The
config refuses a `baselines` key here rather than ignoring it, so a file that looks
like it stores images and does not cannot exist.

**Locale comparison is not on this list, and used to be.** `compareLocales` is a
library function with no caller outside its own tests and no key in the config
(`packages/core/src/judge/locale.ts:135`). A locale comparison means hand-writing
a test, exactly as [spec 0008](specs/0008-locale-runs.md) says — it is not
something a rung buys.

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

## Rung 2 — a shared cache

**Not built.** Recorded here because the gap is easy to mistake for a
misconfiguration.

A durable store is already a render cache, and for LFS it is deliberately kept
*outside* the work tree — a cache committed through the LFS filter would gain an
entry per edit and spend the quota bought for baselines on images nobody will look
at. That is right, and it means the cache is **local to a machine**. A fresh CI
runner starts cold and re-renders every subject, every time, even though the
baselines came down with the checkout.

**The seam is now open and the configuration is not**, which is a narrower gap
than this rung had until 2026-08-04. `RenderCache` is its own contract with its
own rule — it never throws, because the right answer to every cache failure is to
re-render, where a baseline that cannot be read is the only copy of what the
subject looked like and must stop the run. Four backends implement it and the
parity suite checks all four survive their cache being unreachable.

What is still missing is a way for an operator to *choose* one. The cache a run
uses is whichever one its baseline store happens to carry, so pointing this at a
CI cache, an S3 bucket, or the tribunal is still a fork rather than a config key.
That is a field, not an architecture, and the argument for which field it should
be is in [spec 0011](specs/0011-storage-and-cache-primitives.md).

**And images are not the only thing this rung would hold.** The other artifact is
the *document* each baseline was painted from — which is what supplies `before`
and `causes`, and therefore what stops the docket ranking by area. It cannot go in
the repository, and the reason is not its size (about 1KB gzipped, 14.1% of image
bytes). A baseline image escapes the objection to committing derived state because
it is never merged — a conflict is settled by taking one side. A document is
structured text: git will line-merge two regenerated copies into a third that is
neither, and nothing downstream can tell. Noisy, derived and conflict-prone is
exactly the profile of a thing that belongs in a cache.

Content addressing is what makes it tractable, because the awkward part of a
shared cache is knowing when to delete. Key a document by the digest the sidecar
already carries and the question disappears: a digest addresses exactly one
document, so an entry is never stale, only absent — a branch may write without
colliding with main, and eviction costs a lookup rather than an answer. Nothing
has to be deleted at the right time, because nothing has to be deleted.

**The consequence is how far back you can look.** Artifacts are what lenses read,
and a lens written next year reports on everything still held. Held in a cache,
that reaches until eviction; held in a service, indefinitely. Which is a better
reason to climb to rung 4 than storage capacity is.

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

**You get** a surface: builds, a docket, region overlays,
approve and reject as recorded decisions, and retention sweeps. Approval promotes
an artifact the run already produced — nothing in the review path renders, because
a surface that can render can record a baseline nobody ever looked at
([ADR-0021](context/adr/0021-approval-promotes-an-image-that-already-exists.md)).

**You cannot** hand either token to a browser. The review token promotes
baselines, so the adapter keeps both server-side and attaches one per request —
which makes the adapter, not the token, the gate. `authorize` therefore has no
default, and an operator who wants an open surface writes that line in their own
repository where the next reader can see it.

**You also cannot get a build in front of a reviewer without writing the upload
yourself.** Nothing in `packages/cli` or in the shipped action posts to the
ingest route, and the only thing in the repository that does is the Worker's own
test suite. The review UI's client speaks to the *review* half of the surface —
list, detail, decide, image — and never to ingest, so it is not the counterexample
it looks like. The rung has the same no-caller hole rung 5 is marked for, on its
write half, and this table did not say so until 2026-08-03.

**And the docket here leads with causes only when something supplied them.** The
mechanism is worth stating exactly, because the obvious explanation is wrong: the
run passes `collected.causes` on the durable path and the ephemeral path on
identical terms (`packages/cli/src/commands/run.ts:874` and `:827`), so nothing
in the retention mode suppresses them. What is missing is a wire *back*. Causes
are derived by diffing two **snapshots**, and a durable baseline is an image, so a
collector reaching this rung has nothing to derive them from and supplies none —
at which point the ordering falls back to area, which
[ADR-0021](context/adr/0021-approval-promotes-an-image-that-already-exists.md)
records as measured backwards by 6×.

Two consequences follow, and neither is "the durable path cannot rank". A
collector that can reach the previous revision's document — the same thing rung 0
requires — can supply causes here today, unchanged. And **no collector ships at
all**: the one in the tree is a case fixture that declines to supply causes and
says so in a comment, so "supplies none" describes what has been written rather
than what the code permits. Rung 2 is what would make it the default rather than
the adopter's problem, and it is the one that is not built.

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

- **You can build both revisions in CI, and want no stored artifact at all** —
  rung 0. It costs a config file and a collector that can reach two revisions;
  what it buys is that no machine ever has to match another one.
- **A team on one repository** — rung 1. Baselines in the repo, review on the PR.
  Most projects should stop here.
- **Bot commits are unacceptable, or the corpus is large** — rung 3.
- **Reviewers who are not the people running CI** — rung 4.
- **You have been approving small changes for a year** — rung 5 is the only thing
  that will tell you what that added up to.
