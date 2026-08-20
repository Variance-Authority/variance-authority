# Specs

**Everything in this directory is unfinished. That is the entry criterion.**

A spec says what a capability must do, written before the code, and it lives
exactly as long as the capability is incomplete. The moment the thing ships, the
decisions it forced move into an ADR and **the spec is deleted**. So the answer
to "what is left to build" is `ls docs/specs/`, and it is not a table you have to
read a status column out of.

The alternative is a status column, and it fails in a specific way. A directory
of files in four states — `not built`, `built, not wired`, `built, never run`,
`built` — cannot be read from a filename or a number, so nobody can tell whether
`0006` is an idea or a shipped adapter without opening it, and the column drifts
out of date faster than the code it describes. **A directory that needs decoding
stops being read**, and the debt it exists to make visible becomes the thing
hiding it.

## What is left

| Capability | What exists | What does not |
|---|---|---|
| [History service and drift queries](0002-history-store.md) | The rows, the drift arithmetic, both backends, the wire, and a caller: `variance run` records its run, the hashes that moved, and every subject that failed to read the same way twice, then reports how often that has happened before ([ADR-0031](../context/adr/0031-the-run-asks-what-is-recorded-now.md), [ADR-0032](../context/adr/0032-a-flake-rate-divides-by-the-runs-that-asked.md)). | **The `reach` delta, and the journey run end to end.** Four of the five questions are asked by the run and answered in the report. Half of `reach` is answered — *where does this component appear*, for one commit, by the suite comparing itself against itself ([`composition.md`](../composition.md)) — and what is left is the word *started*: a delta needs two of those graphs and nothing writes one to the record. The spec's headline case, a button gaining 2px eleven times, is produced by the pipeline and has never been *run*: that needs eleven runs and eleven approvals, not more code. |
| [Locale runs](0008-locale-runs.md) | `compareLocales` — untranslated strings, boxes that stopped fitting, and what went uncompared — measured against real Chromium layout. | **The axis.** Nothing reads a `locales` key; the word does not appear in the CLI's config. A locale comparison still means hand-writing a test. |
| [Order dependence in a run](0012-order-dependence-in-a-run.md) | `collectAlone`, a budgeted second pass, and a change that vanishes in a clean world reported as order dependence rather than as a regression — refused by `accept`, labelled in the summary, led with in `variance_describe`. Items 0, 1 and 3 of six. | **The sharpener and the memory.** No probe runs, so the writer is never named — which is a position, not a gap, since module-scope leaks are invisible to any probe. What is missing is `packages/session` wired in for the stylesheet case, history so a leak can be seen to persist or to be fixed, and a tool of its own instead of riding on two. |
| [Storage and cache primitives](0011-storage-and-cache-primitives.md) | Applicability pruning, component hashes, nine inspection rules, three baseline backends, a settlement path that reads no baseline image when nothing moved, and a `RenderCache` whose failures cost a render rather than the run. | **Three seams.** The layout is private to one backend, so "next to the component" is unreachable; the rule set is a closed union, so a lens cannot be added; nothing reduces a render document before hashing it. Items 0 and 1 of five are discharged; 2 through 5 are in the file, ordered. |
| [Hosted: who the caller is, and what the bill counts](0014-hosted-who-the-caller-is-and-what-the-bill-counts.md) | Two capability tokens in `tribunal` with a constant-time comparison and one indistinguishable refusal; a history service that will not start without a token; a remote baseline store that takes a bearer. | **An identity, a meter, and a deployable artifact.** A token resolves to a capability and never to *who* or *whose*: the schema is already project-keyed on every table, but the project arrives from a deployment setting and from `?project=`, so nothing stops a credential naming another tenant's. An approval names nobody. Nothing counts anything, and a counter would be a number the customer cannot check. `serveRenderer` has no authentication at all. |
| [A real agent](0013-a-real-agent.md) | Seven MCP tools as pure functions over a report, a protocol codec, `variance serve` — tested against text. `Intent` and `adjudicate` in `core`, reachable from no boundary an agent meets. The full cause-ranked answer, running inside one test file. | **The author loop.** An agent editing components has no way to hold an observation, observe again, and be answered with the difference — the one setting where two documents, and so the strongest answer, are structurally guaranteed. Missing: the session boundary, `observe` and `claim`, the intent wire with its three arms, and the recorded sessions that would correct the tool list. No agent has ever called any of it. |
| [The first published release](0015-the-first-published-release.md) | MIT licensing, non-private manifests at `0.0.0-beta.1`, a lockstep version stamper, and a release workflow that publishes all 21 packages on a `v*` tag. | **A pushed tag, and an install that proves it.** No tag exists, so nothing has reached a registry and no consumer outside this workspace can resolve `@variance-authority/*`. The acceptance test is an install in a directory that is not a clone. |
| [CI that has run](0016-ci-that-has-run.md) | The workflow, the composite action, `variance comment` and its marker, the commit-back with its three refusals, and a Bitbucket recipe. | **One execution.** Nothing has fired on a real pull request: no comment posted, none updated in place, no baseline committed back. The docket is exercised; the delivery is not. |
| [git-LFS proven as git-LFS](0018-git-lfs-proven-as-git-lfs.md) | The store, producing verdicts identical to the directory and remote backends on the same scenarios. | **The filter, ever running.** No image has been committed through clean/smudge, so an un-smudged checkout handing back a pointer file where a PNG should be has only ever been simulated. |
| [Provenance without React](0019-provenance-without-react.md) | `attributeProvenance` — 25 lines over two `data-*` attributes — and a provenance callback that makes the framework a count of implementations. | **An application.** No Vue, Svelte or Angular tree has been through it, so the claim rests on twenty-five lines and two ecosystem facts. |
| [A cross-browser grid](0020-a-cross-browser-grid.md) | `browser` as a config field, the engine in the identity a baseline is stored under, and all three engines painting one document at identical dimensions. | **The corpus, run twice.** Every `prepare` trick was tuned against Chromium and none declares which engines it was verified on. A selectable engine is not a grid. |
| [Tribunal on a real deployment](0021-tribunal-on-a-real-deployment.md) | The baseline store, history backend, build-and-approve model and review surface, with the real SQL executed through `node:sqlite`. | **The platform.** Never run on Cloudflare, so batch atomicity, quotas, object-size ceilings, concurrent Workers and migrating a database that already has rows are all unmeasured. Identity and metering are [0014](0014-hosted-who-the-caller-is-and-what-the-bill-counts.md), deliberately after this. |
| [Evidence from code this project did not write](0022-evidence-from-code-this-project-did-not-write.md) | One corpus, 40 declared cases, both profiles agreeing on it, and two confrontations in `cases/`. | **A denominator that is not ours.** No third-party component library has been scored, the false-alarm rate has never been measured against the demonstrated false alarm, the `list` arm has never reached a verdict through `variance run`, and three headline figures are asserted by no test. The cross-subject graph joins the list: eight components in one application, and every attribution measured from a declared file list rather than from a `--since` against real history. |
| [What a prop controls](0024-what-a-prop-controls.md) | The measurement: seven props of one design system, each contrasted against a rendering holding everything else still, resolving to five distinct sets of bands — and the finding that an added `OwnerFrame` field reaches no stored digest, so this costs no baseline. | **The name of the prop.** A boundary carries one digest over its whole props object, so a run says *this component was handed something different* and never *which thing*. The join in the spike is a table a person wrote. |
| [`accept` tells a new baseline from a changed one](0023-accept-tells-new-from-changed.md) | The refusal that holds: acceptance promotes an image the run produced and never renders one. | **The distinction.** `--all` promotes a never-reviewed subject and a just-regressed one identically, so the gate becomes a recorder — a constraint currently carried by a paragraph telling operators not to do it. |
| [Component relations](0025-component-relations.md) | The file graph, scanned from source and walked backwards from a diff, with `component` as a node kind and a `declared-in` edge reaching it ([ADR-0038](../context/adr/0038-a-change-reaches-a-component-through-files.md)). | **The edge between two components.** `Card → Button` is not a fact this structure holds, so *where does `Button` appear* and *what does `Card` render* are answered through files — which a barrel file turns into everything reaching everything. Four decisions block it, starting with what counts as *renders* when a component arrives through a prop or a variable. |
| [Selection by closure digest](0026-selection-by-closure-digest.md) | `closureOf` and `driftedBetween`: one digest per node over its whole input closure, cycles condensed, unread inputs marked volatile and propagated ([ADR-0039](../context/adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)). | **The storage and the comparison.** A closure digest is only meaningful against an earlier one, and nothing writes one down — so selection still answers from a diff, and inherits every way a shallow clone, a rebase or a wrong `--since` ref can shape one. |
| [A test is selected by what it executed](0027-a-test-is-selected-by-what-it-executed.md) | The product definition, and the measurements that argue for it: a probe census over this repository's own source, and probe cost on realistic work against V8 precise coverage. | **The whole capability**, split into [0028](0028-the-instrument.md), [0029](0029-what-a-run-remembers.md) and [0030](0030-a-diff-lands-on-blocks.md). `variance` cannot run a test suite. The static selector answers *37 files import something connected to this*; the number worth reporting is *7 tests executed it, 2 of them directly*, and the half it closes is the over-inclusion a static graph cannot avoid — an import counted as a render on a fork the run never took. The fork that has never gone the other way is observable by nothing, and stays [`selecting.md`](../selecting.md)'s position rather than this one's target. |
| [The instrument](0028-the-instrument.md) | The transform, and two benchmarks that argue for it. `instrument(source, id)` ships at `packages/sense/src/instrument/index.ts` and is called by `scripts/census.mjs`, `scripts/overhead.mjs` and `tools/instrumented.config.mts` — by no runner. The census puts **10,207 probes over 308 product files, 0.745× Istanbul's statement sites and 0.395× every counter it inserts**; the overhead benchmark puts the counters at **1.005× cold and 1.017× warm against a 1.014× uninstrumented control** — within noise, which is the finding. Both regenerate: `node packages/sense/scripts/census.mjs`, `node packages/sense/scripts/overhead.mjs`. The stack half's cost is not claimed here because [0028](0028-the-instrument.md) does not claim it. | **The worker runtime, the runner seams, and the call stack.** No run instruments anything: the transform is reachable from two benchmark scripts and a vitest config, and from no command an adopter types. This is the only part that manufactures an artifact rather than consuming one, and it carries the kill criterion: above 1.35× overhead the project is not worth building. The counters clear it; the stack half — a push and a pop per region and a `try/finally` around every function — is unbuilt, so the budget is shown to be unspent rather than shown to be enough. |
| [What a run remembers](0029-what-a-run-remembers.md) | Nothing. | **The journal, the index, and the identity a block is stored under.** No crossing is recorded, and the rule deciding when a row may be *trusted* rather than merely read does not exist: a test may be excluded only if a complete, current observation of it is held, and a failing test flushes a prefix of its real reach. |
| [A diff lands on blocks](0030-a-diff-lands-on-blocks.md) | Nothing. | **The mapping and the ladder.** Nothing turns changed lines into a set of tests. The diff must *move* the index — shift what only shifted, mint where structure moved, burn inward to contained blocks and outward to enclosing ones — and every rung climbed must be printed, because a run that declined to narrow and a run that found nothing look identical. |

## Discharged

Numbers are not reused. A gap in the sequence means a spec completed its
lifecycle, not that one was skipped.

| Was | Lifted into |
|---|---|
| Cause-first ranking on every path | [ADR-0027 — a baseline carries what its document said](../context/adr/0027-a-baseline-carries-what-its-document-said.md) |
| An ignore is a declaration, not a blind spot | [ADR-0025 — an ignore names a place or a shape](../context/adr/0025-an-ignore-names-a-place-or-a-shape.md), [ADR-0026 — `ignored` is not `unchanged`](../context/adr/0026-ignored-is-not-unchanged.md) |
| Per-component band hashing | [ADR-0018 — a component's hash covers its own nodes](../context/adr/0018-a-component-hash-covers-its-own-nodes.md) |
| Command-line interface | [ADR-0017 — the exit code is the interface](../context/adr/0017-the-exit-code-is-the-interface.md) |
| Artifact storage: git-LFS and remote | [ADR-0016 — where a baseline is kept decides nothing](../context/adr/0016-where-a-baseline-is-kept-decides-nothing.md) |
| CI integration and PR feedback | [ADR-0019 — one comment, updated in place, leading with causes](../context/adr/0019-one-comment-that-leads-with-causes.md) |
| Storybook adapter | [ADR-0020 — read the artifact, not the configuration](../context/adr/0020-read-the-artifact-not-the-configuration.md) |
| Inspection rules, and where they stop | [ADR-0015 — a rule belongs here if a stored snapshot can decide it](../context/adr/0015-a-rule-is-what-a-stored-snapshot-can-decide.md) |
| Self-hosted review backend | [ADR-0021 — approval promotes an image that already exists](../context/adr/0021-approval-promotes-an-image-that-already-exists.md), [ADR-0022 — deciding is not writing](../context/adr/0022-deciding-is-not-writing.md), [ADR-0023 — a service is named for what it is](../context/adr/0023-a-service-is-named-for-what-it-is.md) |

**Linux verification has no ADR of its own**, and that is the honest outcome: it
forces no decision. It restates ADR-0010's portability claim and ADR-0011's
`incomparable` rule and asks for them to be *measured* on a second machine, which
is a task rather than a decision.
[`docker/linux-verify.sh`](../../docker/linux-verify.sh) is that task, it carries
its own argument, and it has never been run — which the checkpoint tracks, where
unexercised claims belong.

## What a spec here owes

1. **State what is missing, not what exists.** The code is the record of what
   exists, and a spec that describes shipped behaviour is a second copy of it
   that drifts.
2. **Say what would discharge it**, concretely enough that somebody could start.
3. **Leave when the capability lands.** Write the ADRs for the decisions it
   forced, update [`docs/context/checkpoint.md`](../context/checkpoint.md), and
   delete the file. All three, or the debt moves somewhere less visible.

`tools/docs-links.check.ts` and `tools/docs-proposals.check.ts` hold the parts of this that are checkable: every
link resolves, every type a proposal names still exists, and any block listing the
CLI's commands is the binary's own.

## Standing constraints

These hold for anything built here and do not need restating.

- **Nothing has been published, and no tag has been pushed.** The packages are
  MIT and publishable, so what stands between them and a registry is the `v*`
  tag the release workflow waits for — until it exists, obtaining this software
  means cloning it, and no installed version constrains a change made here
  ([0015](0015-the-first-published-release.md)).
- **No telemetry, no analytics, no phone-home.** The only outbound network call
  in the system is to a renderer endpoint the operator supplies.
- **The cheap path requires no infrastructure.** Any capability that needs a
  backend MUST degrade to a working single-run tool without one, and MUST report
  the absence rather than defaulting to a silent negative.
- **Never store pixels in anything that accumulates.** Images are artifacts with
  their own retention (ADR-0011). History is text.
- **An unobservable difference is never reported as no difference** (ADR-0002,
  ADR-0008).
