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

`tools/documentation.test.ts` holds the parts of this that are checkable: every
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
