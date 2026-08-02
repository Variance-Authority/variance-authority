# ADR-0011 — Two retention modes, and a store partitioned by renderer identity

**Status:** accepted
**Date:** 2026-08-02
**Extends:** ADR-0010 (tier-specific environment keys), ADR-0002 (sub-renderer)

## Context

ADR-0010 establishes that the *semantic* representation is portable — machine-bound
inputs cannot reach the box tree — and confines the container to the raster
residue. It does not say how that residue is retained, and the answer is not one
thing.

A stored baseline crosses time, and anything crossing time crosses machines. A
different GPU, driver, font stack, or scale factor paints the same markup
differently, so a baseline is only valid on the machine that wrote it. That
requirement is universally *stated* and almost never *enforced*, which is why a
runner-image upgrade produces a day of mass red that nobody can attribute.

A comparison whose two sides are produced in one run has no such requirement.
There is no second machine to be wrong about.

## Decision

**Two modes, one interface, and the difference is where the other image comes
from.**

- **Ephemeral.** Both images are rendered now, by one renderer, and discarded.
  The machine cancels out by construction. No container, no pinned runner, no
  stored artifact, no comparability question. This mode *removes* the
  requirement rather than satisfying it.
- **Durable.** One image is rendered now and compared against a stored one. The
  store is **partitioned by renderer identity** — `<root>/<identityDigest>/…` —
  so a baseline written by one machine is not merely rejected by another, it is
  not in the directory the other machine reads.

`RenderIdentity` covers renderer, engine build, platform, `deviceScaleFactor`,
and the caller-declared font identities. Every field is something observed to
move pixels without moving markup.

**A cross-identity baseline is `incomparable`, never `unchanged` and never
`changed`.** `find` scans sibling identities rather than only its own, so the
answer is *"this subject has a baseline, on another machine"* rather than *"new
subject"* — a wrong-machine run is one sentence instead of a mass failure with
no cause attached.

### Why the partition, rather than a check

A check is code someone has to remember to call, on a path where forgetting
produces a confident diff rather than an error. The layout makes the rule
structural: the wrong baseline is not found because it is not where the lookup
looks. The check that remains — `comparable` — exists only to *explain*, not to
protect.

### The render cache follows from the partition

Both stores also key rasters by `documentDigest × identityDigest`, so an
unchanged document under an unchanged identity is not re-rendered. Content
addressing means "unchanged" is a fact about what is painted rather than a guess
about the branch (Principle 4), so a rebase, a file move, or a rerun costs
nothing, and a run over 300 subjects where two changed pays for two images.

## What this forecloses

- Sharing a raster baseline across machines. Pixels are machine-bound; this ADR
  confines the cost to the artifact that has it and does not pretend to remove
  it.
- Adding a render input without deciding whether it belongs in `RenderIdentity`.
  Omitting one that moves pixels reintroduces the silent cross-machine compare
  this ADR exists to make impossible.
- A default that stores images. The cheap mode is the one that keeps nothing,
  and it stays the one that requires no configuration.

## Known limits

Font identities are caller-declared strings, not content hashes of bytes. The
renderer probes for substitution by metrics, which is the only signal available
inside a page — `document.fonts.check` answers a different question and returns
`true` for a family invented on the spot. The metric probe reports a
metric-compatible substitute (Arimo for Arial, and the rest of what a Linux
container ships precisely so layout does not move) as missing. That is a false
alarm rather than a false `unchanged`, which is the safe direction, and it is
the same hole ADR-0010 leaves open under "one machine".
