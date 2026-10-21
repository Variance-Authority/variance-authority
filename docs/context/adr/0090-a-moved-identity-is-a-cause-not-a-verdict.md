# ADR-0090 — a moved identity is a cause, not a verdict

**Status:** accepted
**Date:** 2026-10-11
**Amended by:** [ADR-0091](0091-a-baseline-is-named-for-its-subject.md) — §6 as written below: a line is one engine family, a file-backed store keeps one file on it, and the record names which machine painted it
**Supersedes:** [ADR-0011](0011-durable-and-ephemeral-retention.md)'s rule that a
cross-identity baseline is `incomparable`, and
[ADR-0012](0012-observability-and-the-damage-boundary.md) §4's sentence that a
baseline stabilised one way and a run stabilised another are `incomparable`;
[ADR-0088](0088-a-page-is-read-as-nobody-is-using-it.md)'s readings under another
clock, instant, timezone or locale, which it calls `incomparable`; and the
sentences that restate the refusal:
[ADR-0016](0016-where-a-baseline-is-kept-decides-nothing.md)'s summary of
ADR-0011, [ADR-0019](0019-one-comment-that-leads-with-causes.md)'s pinned
container, [ADR-0021](0021-approval-promotes-an-image-that-already-exists.md)'s
sidecar, [ADR-0026](0026-ignored-is-not-unchanged.md)'s baseline from another
machine, [ADR-0049](0049-browser-accessibility-is-an-independent-retained-signal.md)'s
one-sided and cross-engine accessibility evidence,
[ADR-0077](0077-the-config-says-where-an-artifact-lives.md)'s store partition, and
[ADR-0054](0054-presentation-consequence-is-a-signal.md)'s `incomparable`
presentation signal for a missing side
**Relates to:** [`packages/raster/src/settle.ts`](../../../packages/raster/src/settle.ts),
[`packages/observe/src/observe.ts`](../../../packages/observe/src/observe.ts),
[`packages/raster/src/renderer.ts`](../../../packages/raster/src/renderer.ts)

## Context

ADR-0011 refused to compare a baseline painted under one render identity with a
run painted under another, and ADR-0012 §4 extended the refusal to the recipe:
the stabilization and rasterization digests. The refusal was meant to stop a
font stack or a driver from being blamed on a component. What it did instead
was hide every image exactly where a reviewer needs them most.

The mass changes a visual suite meets are an upgrade (a browser, this tool's
own recipe), a migration (styled-components to emotion, a lockfile bump) and a
codemod (one CSS rewrite across thousands of stories). Each moves many subjects
at once, and a few of those moves are regressions. A recipe change answered
"14 incomparable", exited 1, and showed no diff: the gate failed and nobody
could see why or where.

`incomparable` is a cause wearing a verdict's name. Either the pixels moved or
they did not; the identity that moved between the two images is the reason a
reviewer reads first.

## Decision

**A subject with two images is always compared. The verdict is `unchanged` or
`changed`, and a moved identity or recipe is carried as the cause.**

1. **Nothing refuses.** `settle` renders against a baseline from any identity,
   and every observation path — a baseline lookup, two rasters handed in, a
   capture — runs the pixel comparison whatever the identities say. A size
   change from a different scale factor is a change, as any size change is.
2. **The cause is typed and named.** `signals.identity` says whether only this
   tool's recipe moved (`recipe`) or anything else did (`machine`), and
   `signals.moved` lists each field that moved with both values, stored side
   first. The `because` sentence opens with the same list.
3. **An unchanged subject under a moved identity says so.** It is evidence that
   the upgrade did not touch it, which is the half of an avalanche review that
   lets a reviewer stop looking.
4. **The gate does not relax.** A change is a change: it fails until accepted,
   and accepting writes the baseline under the new identity. What groups an
   avalanche for review is the cause it carries, not a softer verdict.
5. **Accepting re-stamps what did not move.** `accept --all`, `--update` and
   `--update-snapshots` write an `unchanged` subject under a moved identity
   again under the run's own, so an upgrade is named once rather than on every
   later run. Its pixels did not move, so nothing unreviewed is adopted.
6. **A write moves the baseline along its line.** A line is one engine family.
   A file-backed store keeps one file per subject on a line, and the identity
   lives in the `.json` record beside the image: platform, scale factor, engine
   build, fonts and recipe. A machine whose identity differs reads that file,
   compares it, and reports the field that moved as the cause. The last accept
   on the line writes the file, so two machines that both accept take turns
   reading the other's as `changed`. Writing a subject also retires its copy in
   an earlier layout's identity directory, and a lookup that misses its own path
   reads those copies nearest identity first, in a fixed order. Once siblings
   are compared, the order would otherwise decide the verdict: after two
   upgrades, the older copy could be read first, and a reversion to the old
   look would read `unchanged`. A matrix of engines is several lines, and each
   keeps its baseline.
7. **A missing side is a change.** Evidence on one side only, an accessibility
   snapshot or a presentation reading, is `changed`, and `because` names the
   side that has none. Nothing is invented from the side that is there: a
   presentation signal read on one side carries no effects. Neither side
   measured is no signal at all, as when no producer looked; a presentation
   reading without layout findings has not measured the layout. A presentation
   signal still changes no subject's verdict (ADR-0054).

The partition by `identityDigest` stays where nobody reads a path: it keys the
render cache and the bucket store's rows. A baseline painted under another
identity is no longer a reason to refuse; it is the baseline, and the field
that differs is the cause.

## Consequences

- A browser upgrade or a recipe change shows every diff, grouped by the
  identity that moved, and the subjects that did not move say so.
- `accept --all` adopts a cross-identity change as it adopts any other change.
  The bulk-acceptance exception for a recipe-only re-baseline is gone with the
  verdict it was an exception to.
- A durable store holds one baseline per line for a subject. An accept after a
  browser upgrade replaces the old build's file in place; a chromium and a
  webkit project keep one each, and a laptop and a Linux runner on Chromium
  share one, the last accept's.
- The tribunal's bucket store does not retire yet: it upserts by identity, and
  a machine's own superseded row still wins its lookup. Two machines that both
  accept therefore each read `unchanged` against the bucket and take turns
  reading `changed` against a file-backed store, which is a difference
  ADR-0016 does not allow. It stands until the bucket and the remote contract
  keep one row per line.
- A container pinned in CI still matters: a baseline from a laptop compared
  with a Linux run is a wall of `changed`, now visible, with the platform named
  as its cause.

## What this forecloses

A verdict that says nothing was compared. A subject that has two images is
never reported without their diff.
