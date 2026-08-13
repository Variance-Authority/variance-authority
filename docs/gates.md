# Can this replace what you are paying for?

Three questions, answered as a scorecard rather than as a pitch. Every row links
to the thing that backs it, and the rows that say **no** are the point of the
page — a comparison that only ever finds in its own favour is an advertisement.

Read [`comparison.md`](comparison.md) for what each product does *better*, and
[`replacing.md`](replacing.md) for what a move actually costs.

## Gate 1 — Percy

**A suite of URLs, captured at several widths, gated in CI.**

| | |
|---|---|
| Snapshot a list of URLs with no collector to write | **yes** — [`route-collector`](../packages/route-collector), [replacing §2b](replacing.md#2b-replacing-percy-on-a-set-of-urls) |
| Take the list from a sitemap instead | **yes** — `sitemap:` with `subjects.kind: "collector"` |
| Several widths per page | **yes**, and each is genuinely laid out: the page is re-navigated at the new size, so a `matchMedia` read at mount decides again |
| Determinism without asking for it | **yes** — animations pinned before the subject is *read*, GIFs frozen on the wire, assets hashed into the key, waits on what was actually requested ([`stabilization.md`](stabilization.md)) |
| Silence a clock or a carousel | **yes**, by element or by difference shape, with a ledger of what each rule absorbed ([`ignores.md`](ignores.md)) |
| Gate a pull request | **yes** — exit codes and `variance comment`; **never run on a real one** ([spec 0016](specs/0016-ci-that-has-run.md)) |
| Cross-browser rendering from one capture | **no**, and out of scope ([spec 0020](specs/0020-a-cross-browser-grid.md)). The largest single thing Percy sells that this does not have |
| Retroactive rules from a dashboard | **no.** An ignore is a declaration in your config and applies to the next run — auditable, and slower |
| A static directory, served for you | **yes** — `directory: './build'` with `subjects.kind: "collector"` plans a subject per `.html`, addressed as the site will be (`about/index.html` → `about`) |
| A crawler | **no.** A sitemap is read and a directory is walked; nothing follows a link, and a sitemap *index* is taken as pages rather than followed |
| A hosted review UI | **no**, by decision. [`tribunal`](../packages/tribunal) is one you deploy, and has never been deployed |

**Verdict: yes for a URL suite gated in CI, provided you do not need cross-browser
and do not need a dashboard.** All three of Percy's on-ramps that do not crawl —
a URL list, a sitemap, a static directory — are shipped paths. The honest blocker for anybody at all is that
nothing is published yet ([spec 0015](specs/0015-the-first-published-release.md)),
so adopting means vendoring this repository.

## Gate 2 — Argos, without the web interface

**Flake handling, mask management, and per-test history from a CLI.**

| | |
|---|---|
| Detect a flaky test | **yes**, and one run earlier than a comparison can: a subject is read twice and disagreement names a component and a band ([`flakiness.md`](flakiness.md)) |
| Say how often it has flaked | **yes** — over a window, dividing by the runs that actually asked ([`history.md`](history.md)) |
| Say whether it has stopped | **yes** — sweeps since the last occurrence, which is the number that decides whether to write a fix or look for one |
| Manage a difference across many screenshots | **yes** — a difference *shape* is a fingerprint, `accept --shape` promotes it wherever it is the whole change, and refuses by name any subject where something else also moved ([`ignores.md`](ignores.md)) |
| Ignore masks that survive layout moving | **yes** — an ignore names an element or a shape, never a coordinate box |
| Shard a suite and merge the shards | **yes**, including promoting a subject *every* shard excluded to a failure ([`packages/cli`](../packages/cli#sharding-report-takes-more-than-one-file)) |
| Upload PNGs produced by something else | **no**, by decision. A baseline is bytes *plus* the identity and document that produced them ([`surface.md`](surface.md)) |
| Auto-ignore a difference after N occurrences | **no**, by decision. The count is reported; the suppression stays a declaration somebody writes down |
| Twenty SDKs | **no.** Three entry surfaces need no collector; anything else is a module you write once |

**Verdict: yes, if your screenshots are produced here.** The one hard "no" is
ingesting foreign images, and it is a position rather than a gap — everything
above the pixel tier depends on a baseline knowing which document produced it.

## Gate 3 — Chromatic

**Storybook, with the suite kept cheap.**

| | |
|---|---|
| A built Storybook with no collector to write | **yes** — five lines of config, demonstrated end to end against a Storybook this project did not write ([comparison §4](comparison.md#4-what-is-written-and-unrun)) |
| Only test what a change could have touched | **yes** — `--since`, from what the last run actually painted, reaching a component through a graph scanned from the source rather than one a bundler produced ([`selecting.md`](selecting.md)) |
| A story read at its own viewport | **yes**, applied to the page before the story mounts |
| Interaction (play) functions before capture | **yes**, and this row said *no* until it was measured. Storybook's preview runs the play function and its phase order is `playing` → `completed` → `storyRendered`, so waiting on `storyRendered` — which this already did — is waiting on the interaction. Asserted against a real story whose subject only exists after a click ([`cases/storybook-case`](../cases/storybook-case)) |
| Accessibility as a product | **partly.** Defects come with a component and a file, which axe does not do — against nine rules rather than ninety, with no triage flow |
| Branch and baseline semantics worked out in production | **no.** Never exercised across a rebase; spec §10's target is unmeasured |
| Reviewers who are not engineers | **no.** No UI, no assignment, no threads |

**Verdict: yes for the capture-and-gate half, no for the review half.** What
Chromatic sells that this does not is the workflow around the diff, and that is
the axis [comparison §2](comparison.md#chromatic) calls the one it loses hardest.

One row on this table was wrong in the pessimistic direction until somebody
checked, which is worth more than the row: a scorecard nobody measures drifts in
whichever direction its author last guessed.

## What is left, and who it belongs to

Every remaining **no** on this page is one of four things, and none of them is
work that was merely not got to yet. They are listed together because the
difference between *this can replace it* and *this has replaced it* is entirely
here.

**Two are decisions somebody has to make.**

- *Foreign PNGs.* Argos's CLI takes an image from anywhere; this has no verb that
  does. [`surface.md §4`](surface.md#an-image-this-system-did-not-paint) argues
  it as a position with the arithmetic attached — without a document there is no
  component, no band, no cause, no settlement — and concludes that accepting them
  "would offer a second, worse tool under the same command name". It is
  *reversible*: an ingested image with an operator-**declared** identity would
  compare on pixels alone, and the reduced power could be stated rather than
  hidden. That is a product decision, not an implementation one.
- *A cross-browser grid.* [Parked deliberately](specs/0020-a-cross-browser-grid.md),
  and the largest single thing Percy sells that this does not have.

**Two are actions on somebody's infrastructure.**

- *Nothing has been published.* No tag, no registry, no install path
  ([spec 0015](specs/0015-the-first-published-release.md)). Every "yes" above is a
  yes for somebody who vendors this repository.
- *Nothing has run on a real pull request*, and no review surface has been
  deployed. The workflow, the composite action, the comment, the commit-back and
  [`tribunal`](../packages/tribunal) are all written and exercised against
  fixtures; none has met production
  ([spec 0016](specs/0016-ci-that-has-run.md),
  [spec 0021](specs/0021-tribunal-on-a-real-deployment.md)).

No amount of further capability closes any of the four.
