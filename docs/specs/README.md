# Specs

**Everything in this directory is unfinished. That is the entry criterion.**

A spec says what a capability must do, written before the code, and it lives
exactly as long as the capability is incomplete. The moment the thing ships, the
decisions it forced move into an ADR and **the spec is deleted**. So the answer
to "what is left to build" is `ls docs/specs/`, and it is not a table you have to
read a status column out of.

That is a change, made on 2026-08-03. This directory previously held nine files
in four states — `not built`, `built, not wired`, `built, never run`, `built` —
five of which described capabilities that ship. A reader could not tell from a
filename or a number whether `0006` was an idea or a shipped adapter, and neither
could the person who wrote it: one file said `not built` while a Dockerfile for it
sat in `docker/`, and another named five of the CLI's six commands. **A directory
that needs decoding stops being read**, and the debt it was meant to make visible
became the thing hiding it.

## What is left

| Capability | What exists | What does not |
|---|---|---|
| [History service and drift queries](0002-history-store.md) | `@variance-authority/history` and `@variance-authority/server` — the rows, the drift arithmetic, the SQLite backend, the wire. Per-component hashing ships too and is recorded in [ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md). | **A caller, and the read one would need.** No run records anything, and the contract has no query that returns a subject's current rows — so the rule "write a row only when a hash moves" is unimplementable as specified. The two candidate shapes are in the file. Decide before building. |
| [Locale runs](0008-locale-runs.md) | `compareLocales` — untranslated strings, boxes that stopped fitting, and what went uncompared — measured against real Chromium layout. | **The axis.** Nothing reads a `locales` key; the word does not appear in the CLI's config. A locale comparison still means hand-writing a test. |
| [Order dependence in a run](0012-order-dependence-in-a-run.md) | Since 2026-08-04: `collectAlone`, a budgeted second pass, and a change that vanishes in a clean world reported as order dependence rather than as a regression — refused by `accept`, labelled in the summary, led with in `variance_describe`. Items 0, 1 and 3 of six. | **The sharpener and the memory.** No probe runs, so the writer is never named — which is a position, not a gap, since module-scope leaks are invisible to any probe. What is missing is `packages/session` wired in for the stylesheet case, history so a leak can be seen to persist or to be fixed, and a tool of its own instead of riding on two. |
| [Storage and cache primitives](0011-storage-and-cache-primitives.md) | Applicability pruning, component hashes, nine inspection rules, three baseline backends, and — since 2026-08-04 — a settlement path that reads no baseline image when nothing moved, and a `RenderCache` whose failures cost a render rather than the run. | **Three seams.** The layout is private to one backend, so "next to the component" is unreachable; the rule set is a closed union, so a lens cannot be added; nothing reduces a render document before hashing it. Items 0 and 1 of five are discharged; 2 through 5 are in the file, ordered. |
| [Hosted: who the caller is, and what the bill counts](0014-hosted-who-the-caller-is-and-what-the-bill-counts.md) | Two capability tokens in `tribunal` with a constant-time comparison and one indistinguishable refusal; a history service that will not start without a token; a remote baseline store that takes a bearer. | **An identity, a meter, and a deployable artifact.** A token resolves to a capability and never to *who* or *whose*: the schema is already project-keyed on every table, but the project arrives from a deployment setting and from `?project=`, so nothing stops a credential naming another tenant's. An approval names nobody. Nothing counts anything, and a counter would be a number the customer cannot check. `serveRenderer` has no authentication at all. |
| [A real agent](0013-a-real-agent.md) | Five MCP tools as pure functions over a report, a protocol codec, `variance serve` — tested against text. `Intent` and `adjudicate` in `core`, reachable from no boundary an agent meets. The full cause-ranked answer, running inside one test file. | **The author loop.** An agent editing components has no way to hold an observation, observe again, and be answered with the difference — the one setting where two documents, and so the strongest answer, are structurally guaranteed. Missing: the session boundary, `observe` and `claim`, the intent wire with its three arms, and the recorded sessions that would correct the tool list. No agent has ever called any of it. |

## Discharged

Numbers are not reused. A gap in the sequence means a spec completed its
lifecycle, not that one was skipped.

| Was | Lifted into |
|---|---|
| Per-component band hashing | [ADR-0018 — a component's hash covers its own nodes](../context/adr/0018-a-component-hash-covers-its-own-nodes.md) |
| Command-line interface | [ADR-0017 — the exit code is the interface](../context/adr/0017-the-exit-code-is-the-interface.md) |
| Artifact storage: git-LFS and remote | [ADR-0016 — where a baseline is kept decides nothing](../context/adr/0016-where-a-baseline-is-kept-decides-nothing.md) |
| CI integration and PR feedback | [ADR-0019 — one comment, updated in place, leading with causes](../context/adr/0019-one-comment-that-leads-with-causes.md) |
| Storybook adapter | [ADR-0020 — read the artifact, not the configuration](../context/adr/0020-read-the-artifact-not-the-configuration.md) |
| Inspection rules, and where they stop | [ADR-0015 — a rule belongs here if a stored snapshot can decide it](../context/adr/0015-a-rule-is-what-a-stored-snapshot-can-decide.md) |
| Self-hosted review backend | [ADR-0021 — approval promotes an image that already exists](../context/adr/0021-approval-promotes-an-image-that-already-exists.md), [ADR-0022 — deciding is not writing](../context/adr/0022-deciding-is-not-writing.md), [ADR-0023 — a service is named for what it is](../context/adr/0023-a-service-is-named-for-what-it-is.md) |

**Linux verification was deleted without an ADR**, and that is the honest
outcome: it forced no decision of its own. It restated ADR-0010's portability
claim and ADR-0011's `incomparable` rule and asked for them to be *measured* on a
second machine, which is a task rather than a decision.
[`docker/linux-verify.sh`](../../docker/linux-verify.sh) is that task, it carries
its own argument, and it has never been run — which now lives in the checkpoint's
open links, where unexercised claims belong.

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

- **Nothing is published and nothing is pushed.**
- **No telemetry, no analytics, no phone-home.** The only outbound network call
  in the system is to a renderer endpoint the operator supplies.
- **The cheap path requires no infrastructure.** Any capability that needs a
  backend MUST degrade to a working single-run tool without one, and MUST report
  the absence rather than defaulting to a silent negative.
- **Never store pixels in anything that accumulates.** Images are artifacts with
  their own retention (ADR-0011). History is text.
- **An unobservable difference is never reported as no difference** (ADR-0002,
  ADR-0008).
