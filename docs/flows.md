# Choose an operating flow

Start with the least infrastructure that answers the question your team needs.
Storage location does not make a verdict more correct: renderer identity and the
observed evidence decide whether two readings are comparable. Deployment decides
who retains the baseline, where review happens, and whether the record survives
long enough to answer questions across runs.

The first four levels are alternative retention and placement choices. Tribunal
and history are services that a durable run can add; one Tribunal deployment can
also supply the remote-baseline and history protocols. Subject acquisition is a
separate choice described in [surface](surface.md), and the renderer may remain
with the run or move to an operator-owned service.

| Level | You operate | Choose it when | Boundary |
| --- | --- | --- | --- |
| 0. Ephemeral | no baseline store | the collector can produce both revisions in one run | no approved baseline crosses runs |
| 1. Directory | a durable filesystem path | one machine or persistent workspace owns the baseline corpus | the path must reach the next run |
| 2. Git LFS | Git LFS and a tracked baseline root | baseline updates should travel with the repository without ordinary PNG blobs in Git history | approval changes the repository |
| 3. Remote baselines | a baseline endpoint, with a token when the service requires one | the corpus must stay out of the repository | an unavailable store stops the run |
| 4. Tribunal | database, object storage, two tokens, and a review adapter | reviewers need a browser docket and recorded decisions | authentication remains the operator's responsibility |
| 5. History | a history endpoint and token | recurrence, churn, or accumulated token drift changes the decision | a run must carry a stable run id and commit |

## Level 0 — ephemeral: compare two revisions now

Ephemeral retention is a complete comparison with no durable baseline. Its
collector supplies the current document and a `before` document for every
subject; the renderer paints both under one identity during the run.

```jsonc
// variance.config.json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "ephemeral",
  "subjects": {
    "kind": "list",
    "ids": ["checkout/empty"],
    "collector": "variance/collector.mjs"
  },
  "fonts": [],
  "report": ".variance/report.json"
}
```

Choose this when CI can build or mount both revisions and no approved image needs
to survive the run. A collector that supplies only the current document does not
satisfy this flow; that subject is reported as failed rather than unchanged.
`baselines` is refused under ephemeral retention because there is no durable
baseline to read or promote.

## Level 1 — directory: one durable filesystem

Directory retention keeps approved baselines in an ordinary writable path:

```json
{
  "retention": "durable",
  "baselines": { "kind": "directory", "root": ".variance/baselines" }
}
```

Choose it for a persistent worker, a single-machine workflow, or a repository
that accepts ordinary image blobs. `variance accept` writes the approved
candidate to the configured root. That root must be present for the next run;
an empty or discarded path means the next run correctly sees no approved
baseline and reports `new`.

[Baseline placement](placement.md) owns the tracking, layout, and render-cache
details for directory and Git-backed roots.

## Level 2 — Git LFS: baselines travel with the repository

Git LFS uses the same durable layout while its filter carries the image bytes:

```json
{
  "retention": "durable",
  "baselines": { "kind": "lfs", "root": ".variance/baselines" }
}
```

Install Git LFS on every machine that checks out or accepts baselines. The store
maintains the tracking declaration beneath its root. If a checkout still holds
LFS pointer text where an image belongs, the store refuses that pointer by name
instead of handing it to the PNG decoder and blaming the renderer.

Choose this when the baseline and its reason should move in the same repository
change as the code. Acceptance writes files that still need an ordinary review
and commit; the tool does not turn a CI credential into permission to push.

## Level 3 — remote baselines: one shared corpus

Remote retention keeps baseline bytes behind the shared `RasterStore` protocol:

```json
{
  "retention": "durable",
  "baselines": {
    "kind": "remote",
    "endpoint": "https://variance.internal",
    "token": { "env": "VARIANCE_BASELINES_TOKEN" }
  }
}
```

Choose it when bot commits, LFS bandwidth, or repository size make a tracked
corpus the wrong operational boundary. `variance accept` writes through the
same endpoint, so approval no longer requires a baseline commit.

The remote client never translates an unreachable endpoint, refused token, or
invalid response into a missing baseline. Those are operator failures and stop
the run; reporting `new` would replace a baseline because the network failed.
Run `serveRasterStore` from
[`@variance-authority/remote`](../packages/remote/README.md) behind infrastructure
you operate, or use the compatible baseline surface supplied by
[`@variance-authority/tribunal`](../packages/tribunal/README.md).

## Level 4 — tribunal: review outside the CI log

Tribunal combines a baseline store, history store, build docket, candidate
images, region overlays, recorded decisions, and retention sweeps. A deployment
uses a database and object storage, plus two different secrets:

- the ingest token lets CI post builds, baselines, and history rows;
- the review token lets a person read the review surface and decide.

The values must differ. Anything that can read an ordinary build log may be able
to read the ingest token, and that capability must not approve a regression. The
review token also stays server-side: the operator's mounting adapter authenticates
the person and attaches the appropriate capability to each request.

Point `variance push` at the deployment with the ingest token:

```json
{
  "review": {
    "endpoint": "https://variance.example.com/api",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  }
}
```

```bash
variance push --config variance.config.json --branch "$GITHUB_REF_NAME"
```

`push` sends the report and the candidate images the run already produced. The
review surface promotes that reviewed artifact; it never renders a replacement.
Keeping `push` separate from `run` also lets several shard reports become one
build and lets an upload retry without rerunning the browser.

The [`@variance-authority/tribunal` reference](../packages/tribunal/README.md)
owns the Worker, Node, and Next.js deployment paths and their authorization
contracts.

## Level 5 — history: recurrence, and drift across runs

History retains semantic observation rows, approvals, token values, and
instability events. It stores no pixels. A configured CLI records the run and
consults that record for:

- how often a changed subject has disagreed with itself;
- how often a blamed component caused an approved change;
- how far a token has travelled across approved changes.

```json
{
  "history": {
    "endpoint": "http://history.internal:7788",
    "token": { "env": "VARIANCE_HISTORY_TOKEN" }
  }
}
```

The run needs an id and commit so later answers can be joined to the build that
produced them. Supported CI environments provide that pair; elsewhere pass it
explicitly:

```bash
variance run --config variance.config.json --run "$RUN_ID" --commit "$COMMIT_SHA"
```

Quiet runs are recorded because churn and flake rates need a denominator.
`variance accept` records approval separately, so rejected changes do not become
product churn. The answers are written into the run report for the summary,
review comment, and agent tools to read without reopening the history service.

Run the Node service from
[`@variance-authority/server`](../packages/server/README.md), use Tribunal's
compatible history surface, or implement the
[`@variance-authority/history` contract](../packages/history/README.md) against
another backend. [What accumulates](history.md) explains the resulting measures.

## The other machine question: where the renderer runs

Baseline placement and renderer placement are independent. Keep rendering in the
CI job unless another machine owns a requirement the job cannot meet.

| Placement | You operate | Choose it when | Boundary |
| --- | --- | --- | --- |
| Inside the run | the browser already installed for the CLI or Playwright test | one job has the required engine, fonts, and capacity | the job pays the browser time |
| Remote renderer | a long-lived `serveRenderer` process | a pinned machine or separately scaled render pool must own the pixels | the service has no built-in authentication |

A remote renderer is selected independently of baseline storage:

```json
{
  "renderer": { "endpoint": "http://pinned-renderer:7777" }
}
```

`serveRenderer` from
[`@variance-authority/remote`](../packages/remote/README.md) exposes no token
setting, so keep it on a trusted network or put authentication in a proxy you
operate. The remote machine must also be able to resolve the resources carried or
referenced by the captured document. A resource the renderer cannot reach is a
collection or render failure, not an empty image.

Renderer identity, not locality by itself, governs comparability. Engine,
platform, scale, font declarations, and rasterization inputs partition durable
baselines; a run that finds a baseline under an incompatible identity reports
`incomparable` rather than blaming the subject.

## Choose the smallest complete flow

- Choose **ephemeral** when the collector can supply both revisions and no
  approved baseline needs to cross runs.
- Choose **directory** when one durable filesystem owns the corpus.
- Choose **Git LFS** when baselines should travel with repository changes.
- Choose **remote baselines** when the corpus belongs outside the repository.
- Add **Tribunal** when review needs a browser docket and recorded decisions.
- Add **history** when recurrence or accumulated drift changes what a reviewer
  should do.
- Keep the **renderer inside the run** until a pinned or separately scaled
  machine is an actual requirement.

The [first-observation guide](start.md) begins with the host that already owns
the state. [Baseline placement](placement.md) carries the complete storage
trade-offs, and [surface](surface.md) carries acquisition and materialization
choices.
