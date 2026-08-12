import { BANDS, type Band } from '../compare/band.js';
import type { CanonicalValue } from '../format/canonical.js';
import type { Digest } from '../format/hash.js';
import { digestValue } from '../format/hash.js';
import type { ComponentHash, SemanticSnapshot } from '../format/snapshot.js';
import { boundaries, shapeOf, UNATTRIBUTED } from './boundary.js';

export type { ComponentHash } from '../format/snapshot.js';
export { UNATTRIBUTED } from './boundary.js';

/**
 * The digests a comparison of two component states actually reads.
 *
 * `movedBands` used to take two `ComponentHash`es, which carry a name and an
 * instance count neither side of the comparison consults. Narrowing it to the
 * digests is what lets a per-instance record (`ComponentInstance`, which has no
 * `instances` count because it *is* one) be compared by the same function —
 * rather than by a second copy of the band mapping, which is the one thing in
 * this file that must not exist twice: a subject relaxed to `layout` has to
 * absorb the same bands whichever shape the caller happened to be holding.
 */
export interface BandDigests {
  readonly structure: Digest;
  readonly semantics: Digest;
  readonly text: Digest;
  readonly style: Digest;
  readonly geometry?: Digest;
}

/**
 * Per-component content hashes, one per band.
 *
 * `SemanticSnapshot` hashes a whole subject. That answers "did anything change"
 * and nothing else: it moves whenever anything inside it moves, so it cannot say
 * *which area*, and a record built on it says "the page changed" on every commit.
 *
 * These hashes are the unit a history is kept in. Text, and small — a component
 * that did not change contributes the same digest it did last time, so the only
 * thing worth recording is the difference.
 */

/**
 * Hash every component boundary in a subject.
 *
 * Ordered by component name so an unchanged subject produces byte-identical
 * output across runs.
 *
 * The walk and the per-boundary shape live in {@link ./boundary.js}, which
 * {@link ./instances.js} shares — one definition of what a component's own
 * content is, read by the aggregate and by the per-instance form.
 */
export function hashComponents(snapshot: SemanticSnapshot): readonly ComponentHash[] {
  const layout = snapshot.profile.layout;

  const accumulated = new Map<
    string,
    {
      structure: CanonicalValue[];
      semantics: CanonicalValue[];
      text: CanonicalValue[];
      style: CanonicalValue[];
      geometry: CanonicalValue[];
    }
  >();

  for (const boundary of boundaries(snapshot.root)) {
    const shape = shapeOf(boundary, layout);

    const entry = accumulated.get(boundary.component) ?? {
      structure: [],
      semantics: [],
      text: [],
      style: [],
      geometry: [],
    };
    entry.structure.push(shape.structure);
    entry.semantics.push(shape.semantics);
    entry.text.push(shape.text);
    entry.style.push(shape.style);
    entry.geometry.push(shape.geometry);
    accumulated.set(boundary.component, entry);
  }

  return [...accumulated.entries()]
    .map(([component, entry]) => ({
      component,
      instances: entry.structure.length,
      structure: digestValue(entry.structure),
      semantics: digestValue(entry.semantics),
      text: digestValue(entry.text),
      style: digestValue(entry.style),
      ...(layout ? { geometry: digestValue(entry.geometry) } : {}),
    }))
    // Code-unit order, not `localeCompare`. The doc above promises byte-identical
    // output for an unchanged subject, and a locale-aware comparison makes that a
    // promise about the machine's `LANG` — which was tolerable while these were
    // internal and is not now that they are written into a sidecar, committed
    // beside a baseline, and read back on someone else's runner.
    .sort((a, b) => (a.component < b.component ? -1 : a.component > b.component ? 1 : 0));
}

/**
 * Which components *caused* a change, given both revisions' hashes.
 *
 * The arithmetic behind cause-first ranking, and the reason a baseline carries
 * its component hashes at all. `rankRegions` takes a list of cause names and,
 * given none, falls back to area — which
 * [journal 0013](../../../../docs/context/journal/0013-observability.md)
 * measured as backwards by 6×, because area measures displacement rather than
 * cause. This is where that list comes from on a path with no second document.
 *
 * The distinction is the split ADR-0018 built the bands for:
 *
 * - **`structure` or `style` moved** — the component's own content is different.
 *   It is a cause.
 * - **only `geometry` moved** — the component is byte-identical and its box is
 *   somewhere else. Something *else* moved it, so it is collateral, and naming
 *   it would send a reviewer to a file nobody edited.
 * - **appeared or disappeared** — a component present on one side only is a
 *   cause. Something decided to render it or to stop.
 *
 * `instances` is deliberately not consulted. A component rendered five times
 * instead of four has a different `structure` digest for the subject, and the
 * count moving on its own — the same component, the same content, one more of
 * them — is a change in whatever decided how many, not in this component.
 *
 * A profile with no layout supplies no `geometry`, so on that tier every
 * difference is `structure` or `style` and every changed component is a cause.
 * That is correct rather than degraded: with no boxes, nothing was displaced.
 */
export function causesBetween(
  before: readonly ComponentHash[],
  after: readonly ComponentHash[],
): readonly string[] {
  const previous = new Map(before.map((entry) => [entry.component, entry]));
  const causes: string[] = [];

  for (const entry of after) {
    // `(unattributed)` is not a component and can never be a cause. It is the
    // bucket for nodes whose provenance chain broke, so it collects unrelated
    // parts of a page under one name — and nothing downstream could act on it
    // anyway: a region with no owner reports no component, so it would never
    // match. A broken chain is a defect in this tool and is reported as
    // `unattributed` where that means something, not smuggled in here as a
    // culprit.
    if (entry.component === UNATTRIBUTED) continue;

    const was = previous.get(entry.component);
    if (was === undefined) {
      causes.push(entry.component);
      continue;
    }
    if (ownContentMoved(was, entry)) causes.push(entry.component);
  }

  // Removals too, and they are the case a candidate-only walk cannot see: a
  // component that stopped rendering leaves regions behind it, and the component
  // that used to be there is exactly the name a reviewer needs.
  const present = new Set(after.map((entry) => entry.component));
  for (const entry of before) {
    if (entry.component === UNATTRIBUTED) continue;
    if (!present.has(entry.component)) causes.push(entry.component);
  }

  return causes.sort();
}

/**
 * Whether a component's *own content* differs, ignoring where its box ended up.
 *
 * Deliberately not phrased in bands, because it is not a band question. Both
 * `structure` and `geometry` map to the `geometry` band, and this has to keep
 * them apart: a component whose tree changed edited itself, and a component
 * whose rect moved was pushed. That distinction is the entire cause/collateral
 * result, and asking it through the band mapping would need the digests back
 * again to answer it.
 *
 * The list is every digest a component owns except `geometry`. It grew by two on
 * 2026-08-06 without changing meaning: `semantics` and `text` used to be inside
 * `structure`.
 */
function ownContentMoved(before: BandDigests, after: BandDigests): boolean {
  return (
    before.structure !== after.structure ||
    before.semantics !== after.semantics ||
    before.text !== after.text ||
    before.style !== after.style
  );
}

/**
 * Which frequency bands moved between one component's two hashes.
 *
 * The reason the digests were split. A baseline carries hashes and not
 * documents, so "what changed here" used to be answerable only as a boolean —
 * and a boolean cannot serve a route-level test, whose entire request is *tell
 * me when the page stops assembling and never when it is repainted*.
 *
 * The mapping is exact and it is the same one `bandOf` applies to a delta, which
 * is the property that matters: a subject relaxed to `layout` must absorb the
 * same things whether the run held two documents or two sidecars. Two mappings
 * would be one drift away from a config key meaning different things on the two
 * paths, discovered as a regression somebody let through.
 *
 * | digest | band | what it covers |
 * |---|---|---|
 * | `semantics` | `a11y` | role, accessible name, ARIA state |
 * | `text` | `content` | text runs |
 * | `structure` | `geometry` | tags, aliases, attributes, child boundaries |
 * | `geometry` | `geometry` | rects and computed layout output |
 * | `style` | `token` | declared values and custom properties |
 *
 * `texture` never appears. It is raster residue by definition, and a component
 * hash is built from a document — so the band a comparison of hashes cannot
 * decide is *absent* from the answer rather than reported as unmoved, which is
 * ADR-0002's rule applied to a narrower question.
 *
 * A missing `geometry` on either side is the profile saying it has no layout
 * engine, and is not a difference. Treating absent as a change would report
 * every component as having moved the moment a jsdom baseline met a Chromium
 * run — which the environment key already refuses as `incomparable`, so this
 * would be a second, wronger answer to a question already settled.
 */
export function movedBands(before: BandDigests, after: BandDigests): readonly Band[] {
  const moved = new Set<Band>();

  if (before.semantics !== after.semantics) moved.add('a11y');
  if (before.text !== after.text) moved.add('content');
  if (before.structure !== after.structure) moved.add('geometry');
  if (before.style !== after.style) moved.add('token');
  if (
    before.geometry !== undefined &&
    after.geometry !== undefined &&
    before.geometry !== after.geometry
  ) {
    moved.add('geometry');
  }

  return BANDS.filter((band) => moved.has(band));
}

/**
 * Every band that moved anywhere in the subject, given both revisions' hashes.
 *
 * A component present on one side only contributes `geometry`: something was
 * added or removed, which is the structural half of that band however the rest
 * of it compares. It deliberately does not contribute `a11y` or `content` as
 * well — a component that is simply not there did not *rename* anything, and
 * inflating the answer would make a level that absorbs nothing look like the
 * only safe choice.
 */
export function bandsBetween(
  before: readonly ComponentHash[],
  after: readonly ComponentHash[],
): readonly Band[] {
  const previous = new Map(before.map((entry) => [entry.component, entry]));
  const present = new Set(after.map((entry) => entry.component));
  const moved = new Set<Band>();

  for (const entry of after) {
    const was = previous.get(entry.component);
    if (was === undefined) moved.add('geometry');
    else for (const band of movedBands(was, entry)) moved.add(band);
  }

  for (const entry of before) {
    if (!present.has(entry.component)) moved.add('geometry');
  }

  return BANDS.filter((band) => moved.has(band));
}
