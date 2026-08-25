# ADR-0048 — A scenario archive holds semantic objects, not run artifacts

**Status:** accepted
**Date:** 2026-08-25
**Extends:** ADR-0011 (ephemeral by default), ADR-0044 (capture material and
rendering placement are independent)
**Relates to:** ADR-0047 (a runtime scenario is a witnessed path)

## Context

A runtime execution can remain a value like `Trail`, but comparing it after the
process exits needs addressable semantic evidence. Existing stores have stronger,
different meanings. `HistoryStore` accumulates bounded rows for aggregate
questions. `RasterStore.put` promotes a baseline under renderer identity. A
`CaptureArtifact` may carry pixels or a resource-closed document and only
optionally carries a semantic snapshot.

Writing a scenario into any of those would make an inquiry look like history or
promotion, or retain material its comparison does not need.

## Decision

**Runtime scenarios are ephemeral by default; their optional durable archive is
a versioned manifest over content-addressed canonical `SemanticSnapshot`
objects.**

The manifest addresses project, run, scenario, execution, precondition, profile,
attempt, and frames. An observed frame carries two identities: the digest of the
complete canonical snapshot addresses evidence, while `renderHash` identifies a
machine state. Equal snapshot objects are stored once.

Archival is opt-in and requires declared expiry, access, deletion, and an
admission decision for every snapshot before any write. A snapshot the policy
cannot retain is refused. The object is never redacted after hashing, because the
digest would then address evidence the archive does not hold.

Expiry or a missing object is unobserved, never reconstructed from a state hash.
Garbage collection removes expired manifests and objects no retained manifest
references.

The archive API accepts no raster, render document, event payload, history row,
approval, or baseline. Derived assessments are recomputed from snapshots rather
than stored as authoritative results.

## Consequences

The default scenario path performs no I/O and leaves every accumulating store
untouched. Durable comparisons can be reopened across processes without making
semantic evidence part of baseline lineage.

Text-only is not harmless. Semantic snapshots contain page text, accessible
names, attributes, URLs, and source evidence. The retention contract therefore
applies to the snapshot itself, not only to Act payloads the scenario record
already excludes.

The archive partially supplies the addressable-capture requirement in spec 0033.
It does not make arbitrary old runs comparable unless those runs opted into this
archive and retained the required objects.
