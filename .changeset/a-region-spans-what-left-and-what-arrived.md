---
'@variance-authority/cli': minor
'@variance-authority/core': minor
'@variance-authority/mcp': patch
'@variance-authority/observe': minor
'@variance-authority/playwright-test': minor
'@variance-authority/raster': minor
'@variance-authority/remote': minor
'@variance-authority/report': minor
'@variance-authority/store': minor
'@variance-authority/tribunal': minor
'@variance-authority/unit-test': patch
'@variance-authority/vitest-browser': minor
---

A changed region is joined against the baseline's nodes as well as this render's

A change that replaces an element paints over the old element's box and the new
one's, and `attributeRegions` read only one snapshot. On todomvc's broken toggle,
71% of the changed region is inside the checkbox that left and 88.75% inside the
div that arrived. Neither reaches the 0.9 containment, so the region named the
row around both.

`AttributionOptions.before` is now required: the snapshot of the revision the
pixels are compared against, or `undefined`. Each node is joined against the
area its own box and the box of the node the differ's matcher pairs it with in
`before` cover together: the two places, not the rectangle that holds both.
A box that left is placed by where it was in its own image, whose corner is the
new `AttributionOptions.beforeOrigin`: by default the before snapshot's root, so
a subject the page moved between two clipped shots joins where its pixels are.
A call that states `origin` with a `before` snapshot and no `beforeOrigin`
throws, since a corner guessed from the other image is right only when the page
did not move.

A baseline keeps that snapshot. `Raster.snapshot` is a `PackedSnapshot`, the
tree gzipped and in base64, written by the Playwright fixture, its promotion,
the Vitest browser provider and the CLI's image sidecars. `packSnapshot` and
`unpackSnapshot` are exported from `@variance-authority/observe`. Every store
carries it as text: `sidecarFrom` keeps it, `variance push` forwards it, and
tribunal stores it in new `baselines.snapshot` and
`build_subjects.candidate_snapshot` columns (schema 21, migration
`0019_baseline-snapshot.sql`) and promotes it on approval. On
`cases/storybook-case` it adds 3.2–5.4 KB to each sidecar.

A baseline without a snapshot says so. When a changed verdict has regions and
its baseline kept no snapshot, or one that will not unpack, the reason ends
*the baseline records no snapshot of its nodes, so regions were joined against
this render's boxes alone: an accepting run records one on a revision where
this subject is unchanged*. An accepting run — `--update-snapshots`, Vitest's
`--update`, `variance accept` — now re-stamps an unchanged baseline that kept no
snapshot, as it re-stamps one painted under another identity, and the
observation marks it `signals.snapshot: 'unrecorded'`; `restamps` in
`@variance-authority/core/judge` is the one rule all three ask. Every other
verdict the mark is on ends *the baseline records no snapshot of its nodes, and
an accepting run records this one*. Two images
compared directly get the same clause, naming the before image, without the
remedy, and are never marked.

A subject whose document has not moved settles on its digest and builds no
observation to mark, so `settle` now renders a pictured baseline that kept no
snapshot when this run collected one, with the reason *the baseline records no
snapshot of its nodes, so this run renders it for an accepting run to record
one*. A suite of baselines accepted before this release renders them on every
run until an accepting run re-stamps them. Against tribunal, the accepting run
that re-stamps them is one whose `remote` store writes there; an approval
decides only a changed subject, so it re-stamps none. `Described.keepsSnapshot`
is the new required field it reads:
the durable, LFS and tribunal stores derive it from the sidecar with
`keepsSnapshot` from `@variance-authority/core/format`, and the remote store
refuses a description without it. A packed snapshot now opens with a `v1:`
header naming its format version, `PACKED_SNAPSHOT_HEADER`, and a snapshot
without it counts as not kept. `unpackSnapshot` reads one as not recorded
unless every node in it is one, with `isSemanticSnapshot`, new in
`@variance-authority/core/format`: the check `@variance-authority/unit-test`
already made of a capture file's snapshot, which now asks it. Tribunal serves API 6, which describes a
baseline with `keepsSnapshot`; `variance push` against an older deployment names
the refused descriptions when the project's `remote` baselines are stored there,
and the remote store's refusal names tribunal before API 6 and a
`serveRasterStore` from an earlier `@variance-authority/remote`: upgrade the
server, tribunal or your own, before the client. `settle` takes this run's snapshot as a
fifth argument. `variance accept` and the MCP changelog call these subjects
*unchanged and re-stamped* rather than re-stamped under this run's identity,
which was untrue of them. The render cache no longer hands on a snapshot an
entry kept.
