# Choose an operating flow

**[Variance Authority](README.md)** is a visual regression system you run yourself: it
renders a UI state, compares it against the baseline you approved, and reports
what changed in the vocabulary of your source — the component that drew the
pixels and the `file:line` it was written at.

This page is for whoever decides how that comparison is deployed: where approved
baselines are kept, who reviews a change, and which machine paints the images.
New here? Start with [your first run](start.md).

```bash
npm install --save-dev @variance-authority/cli
npx variance run --config variance.config.json
```

A **subject** is one named UI state you asked for and can ask for again,
identified by a stable id such as `checkout/empty`. A run renders each subject,
captures a **reading** — the markup, the CSS that applied, the boxes it
produced, and where available the image — and compares that reading against the
subject's stored baseline to produce a verdict: `unchanged`, `changed`, `new`,
or `incomparable`.

Where you keep the baseline does not make that verdict more correct. What
decides whether two readings are comparable is **renderer identity** — the
engine, platform, scale, font declarations, and rasterization inputs that
painted them, covered under [where the renderer
runs](#the-other-machine-question-where-the-renderer-runs) below — and the
evidence each reading actually captured. Deployment decides who keeps the
baseline, where review happens, and whether the comparison stays available long
enough to answer questions across runs.

The first four levels below are alternative choices about **retention** — where
approved baselines live and how long they last, set by the `retention` field and
the `baselines` section in each example. **Placement** — which machine runs the
browser that paints each reading — is a separate axis, covered later on this
page. [Tribunal](../packages/tribunal) and
history are services a durable run can add; one Tribunal deployment can supply
both the remote-baseline and the history protocol. How each subject is reached
in the first place is a separate choice, described in [how subjects are
acquired](surface.md).

| Level | You operate | Choose it when | The constraint you accept |
| --- | --- | --- | --- |
| 0. Ephemeral | no baseline store | one run can produce both revisions of the UI | no approved baseline crosses runs |
| 1. Directory | a durable filesystem path | one machine or persistent workspace owns the baseline corpus | the path must reach the next run |
| 2. Git LFS | Git LFS and a tracked baseline root | baseline updates should travel with the repository without ordinary PNG blobs in Git history | approval changes the repository |
| 3. Remote baselines | a baseline endpoint, with a token when the service requires one | the baseline corpus must stay out of the repository | an unavailable store stops the run |
| 4. Tribunal | database, object storage, two tokens, and a review adapter | reviewers need a browser page per build and a recorded decision on each subject | authentication remains the operator's responsibility |
| 5. History | a history endpoint and token | recurrence, churn, or accumulated token drift changes the decision | a run must carry a stable run id and commit |

## Level 0 — ephemeral: compare two revisions now

Ephemeral retention is a complete comparison with no durable baseline. Its
**collector** — the module that reaches each UI state and says when it is ready
to be captured — supplies the current document and a `before` document for every
subject; the renderer paints both under one identity during the run.

```jsonc
// variance.config.json
{
  "project": "checkout-ui",
  // The observation profile: what the capture can see at all. "chromium"
  // resolves computed style, layout boxes and pixels; "jsdom" sees structure
  // and declared style only, and produces no image.
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
that accepts ordinary image blobs. `npx variance accept` writes the approved
candidate to the configured root. That root must be present for the next run; an
empty or discarded path means the next run sees no approved baseline and reports
`new`.

[Baseline placement](placement.md) carries the tracking, layout, and
render-cache details for directory and Git-backed roots.

## Level 2 — Git LFS: baselines travel with the repository

Git LFS uses the same durable layout while its filter carries the image bytes:

```json
{
  "retention": "durable",
  "baselines": { "kind": "lfs", "root": ".variance/baselines" }
}
```

Install Git LFS on every machine that checks out or accepts baselines. The store
maintains the `.gitattributes` tracking declaration beneath its root. A checkout
that still holds LFS pointer text where an image belongs is refused by name, so
an unfetched pointer reads as a setup failure rather than as a changed image.

Choose this when the baseline and its reason should move in the same repository
change as the code. Acceptance writes files into your working tree; reviewing and
committing them is yours, and no CI credential does it for you.

## Level 3 — remote baselines: one shared corpus

Remote retention keeps baseline bytes behind the shared `RasterStore` protocol —
the interface every baseline backend implements to look up a baseline for a
subject and identity, and to save an approved one:

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
corpus the wrong place to keep the images. `npx variance accept` writes through
the same endpoint, so approval no longer requires a baseline commit.

An unreachable endpoint, a refused token, or an invalid response stops the run.
None of them is reported as a missing baseline, so a network failure can never
lead the next `accept` to overwrite the only approved copy. Run
`serveRasterStore` from
[`@variance-authority/remote`](https://variance-authority.dev/reference/packages/remote)
behind infrastructure you operate, or point the endpoint at the compatible
baseline API of
[`@variance-authority/tribunal`](https://variance-authority.dev/reference/packages/tribunal).

## Level 4 — tribunal: review outside the CI log

Tribunal owns review and retention, not rendering: `push` uploads the report and
candidate images the run already produced, and approval promotes those exact
images **without another browser render**.

Tribunal combines a baseline store, a history store, a **build docket** — the
browser page listing each build's subjects awaiting a decision — candidate
images, region overlays, recorded decisions, and retention sweeps. A deployment
uses a database and object storage, plus two different secrets:

- the ingest token lets CI post builds, baselines, and history rows;
- the review token lets a person read the review pages and decide.

The two values must differ, and Tribunal refuses a deployment that gives one
string both capabilities. Anything that can read an ordinary build log may be
able to read the ingest token, and that capability must not be able to approve a
regression. The review token stays server-side: your mounting adapter
authenticates the person and attaches the capability to each request.

Point `npx variance push` at the deployment with the ingest token:

```json
{
  "review": {
    "endpoint": "https://variance.example.com/api",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  }
}
```

```bash
npx variance push --config variance.config.json --branch "$GITHUB_REF_NAME"
```

`push` stays separate from `run`, so several shard reports can become one build
and an upload can retry without rerunning the browser.

The [`@variance-authority/tribunal`
reference](https://variance-authority.dev/reference/packages/tribunal) carries
the Worker, Node, and Next.js deployment paths and their authorization
contracts.

## Level 5 — history: recurrence, and drift across runs

History retains semantic observation rows, approvals, resolved **design token**
values, and instability events. A design token here is a CSS custom property
such as `--va-space-3` — not the bearer tokens this page uses elsewhere for
authentication (`VARIANCE_BASELINES_TOKEN` and the rest); the two share a name
and nothing else. History stores no pixels. A configured CLI records the run
and consults what it has recorded for:

- how often a changed subject has disagreed with itself;
- how often a blamed component — a named region inside a subject's rendering,
  such as `Button`, tracked separately from the subject as a whole — caused an
  approved change;
- how far a design token's resolved value has travelled across approved
  changes.

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
npx variance run --config variance.config.json --run "$RUN_ID" --commit "$COMMIT_SHA"
```

Runs in which nothing changed are recorded too, because churn and flake rates
need a denominator. `npx variance accept` records approval separately, so a
change you rejected does not count as product churn. The answers are written
into the run report, so the summary, the review comment, and the agent tools read
them without reopening the history service.

Run the Node service from
[`@variance-authority/server`](https://variance-authority.dev/reference/packages/server),
point the endpoint at Tribunal's compatible history API, or implement the
[`@variance-authority/history`
contract](https://variance-authority.dev/reference/packages/history) against
another backend. [What accumulates](history.md) explains the resulting
measures.

## The other machine question: where the renderer runs

Baseline placement and renderer placement are independent. Keep rendering in the
CI job unless another machine owns a requirement the job cannot meet.

| Placement | You operate | Choose it when | The constraint you accept |
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
[`@variance-authority/remote`](https://variance-authority.dev/reference/packages/remote)
exposes no token setting, so keep it on a trusted network or put authentication
in a proxy you operate. The remote machine must also be able to resolve the
resources the captured document carries or references. A resource the renderer
cannot reach is a collection or render failure, not an empty image.

Moving the renderer to another machine does not by itself make readings
incomparable — a different engine, platform, scale factor, font declaration, or
rasterization input does. A run that finds a baseline under an incompatible
identity reports `incomparable` and names what differs, rather than reporting a
change in the subject.

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

[Your first run](start.md) begins from the harness that already reaches the
state. [Baseline placement](placement.md) carries the complete storage
trade-offs, and [how subjects are acquired](surface.md) carries the
collection and materialization choices.
