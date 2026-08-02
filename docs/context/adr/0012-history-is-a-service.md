# ADR-0012 — History is a service; artifacts default to git-LFS

**Status:** accepted, **not implemented**
**Date:** 2026-08-02
**Extends:** ADR-0010 (tier-specific environment keys), ADR-0011 (retention)
**Origin:** direct steer, over three rounds —

> *"we 'hash' regions of image, or boundaries of components (how to split)? and
> track change -> git-commit. So we will keep memories when a given area
> changed."*
>
> *"OF COURSE the only option to handle history is EXTERNAL DATABASE. Nothing
> locally can survive merge conflicts in big repo."*
>
> *"Where results are stored at? Git-LFS, remote server. You chose. … backend is
> optional, git LFS is default."*

## Context

Everything this project had built answers questions about **one comparison**. One
comparison is what a reviewer is already good at, and it is blind to the failure
that actually degrades a design system: a button gains 2px, eleven times, each
approved correctly, and nobody ever saw the 22px change. The quantity that would
have caught it is a sum, and nothing was summing.

Adding the sum meant answering two questions that had never been asked: *what is
recorded*, and *where does it live*.

## Decision 1 — what is recorded

**Per (subject, component): one content hash per band, plus the resolved token
values. Never pixels, never images, never coordinates.**

- **Boundary-scoped.** A component hashes its own nodes and stops at the next
  component boundary. If a component's hash covered its whole subtree, a leaf
  edit would move every ancestor's hash and the history would report "the page
  changed" on every commit forever — collateral, expressed as content addressing.
- **One hash per band, not one blended hash.** Structure, style and geometry
  separately, because a profile that cannot observe geometry reports `unobserved`
  rather than passing (ADR-0002). A single blended hash would make the same page
  hash differently depending on which tier CI happened to run, and the record
  would churn on infrastructure changes.
- **Key is `subject × component type`**, instances folded in order. Instance
  identity is unstable — a list item's index moves when the list moves, which
  breaks exactly when content changes. The run report already answers "which of
  the eight buttons"; history answers "when did this area last change".

### Why not pixel counts

The first implementation recorded `changedPixels`, and the end-to-end refuted it
inside an hour: a **1px** change to `--va-space-3` produced **4949 changed
pixels**, because the count is dominated by how much page sits below the edit.
It measures displacement, not drift — the same defect `rankRegions` was written
to fix (journal 0013), compounded over time instead of over one image. It is also
machine-bound, so accumulating it across runs violates the rule ADR-0011 exists
to enforce.

### Why not a grid of image-region hashes

Considered and refused for three reasons: a pixel hash is machine-bound, so the
record churns on runner configuration; a grid cell is a coordinate, so a 1px
reflow moves every cell below the edit; and a cell resolves to no file, which
removes the only thing that makes a finding actionable. It has one legitimate
use — the texture residue the semantic tier cannot see — scoped to a single
`RenderIdentity` and never shared.

## Decision 2 — where it lives

**An external service. Optional. Absent means single-run answers only.**

Two local designs were tried and both fail for the same underlying reason.

- **A git-committed lock file** puts derived state under human merge resolution.
  Two branches produce two hashes for one key and there is no correct hand-merge
  — you have to re-run to know the answer. Worse: **the hashes of a merge commit
  are neither branch's**, so a committed file always describes a state that no
  longer exists by the time it lands.
- **An append-only JSONL** has the same merge problem plus interleaved writes
  from concurrent CI jobs.

The property wanted is not "survives merge conflicts". It is **has none** — and a
database has none because it stores *observations*, not state. Two branches
observing different hashes for one key are two rows, not a conflict, and the
query selects the lineage it cares about. That is Principle 4 (content-addressed,
never branch-addressed) landing somewhere it can finally be enforced.

**The service is optional and its absence is reported, not defaulted.** With no
service the tool answers every single-run question and says plainly that nobody
is keeping a record — because an agent told "no drift" concludes the product is
stable, when what happened is that the question was never asked.

## Decision 3 — artifacts are not history

Images are a separate artifact with separate rules: **git-LFS by default, a
remote server if you run one.** LFS is viable for images precisely where it is
not viable for history — a baseline PNG is never hand-merged, you take one side —
and it keeps the default deployment at "your repo, your infrastructure, no
backend".

## Consequences

- A row is roughly 100 bytes and is written only when a hash actually moves. A
  300-subject run where two components changed writes two rows.
- The record is text throughout, so it stays reviewable and cheap to retain.
  Nothing in the history has to be opened in an image viewer.
- The store is reached through a narrow interface — `record`, `lastChanged`,
  `churn`, `valueJourney`, `reach` — every operation a small slice. That is the
  point of a database over a file: you query it, you do not parse it.
- Adopting the tool requires no backend. Adopting *history* requires one.

## What this forecloses

- Any claim about accumulated change made from a local file.
- Recording anything in the history that cannot be read as text in a terminal.
- A default that requires infrastructure. The cheap path must stay the one that
  needs nothing.

## Status note

Nothing above is implemented. The per-component band hashing does not exist —
`SemanticSnapshot` carries `structureHash` and `styleHash` at *subject* level
only. The store interface does not exist. This ADR records a settled decision so
the next implementation does not re-litigate it, and the README says plainly that
this half is designed rather than built.
