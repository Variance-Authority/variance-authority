import { BANDS, type Band } from '../compare/band.js';
import { declaredIn } from '../compare/cascade.js';
import type { CanonicalValue } from '../format/canonical.js';
import type { Rect } from '../format/capture.js';
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
  const declared = declaredIn(snapshot);

  const accumulated = new Map<
    string,
    {
      structure: CanonicalValue[];
      semantics: CanonicalValue[];
      text: CanonicalValue[];
      style: CanonicalValue[];
      geometry: CanonicalValue[];
      boxes: (Rect | null)[];
      values: Map<string, Set<string>>;
    }
  >();

  for (const boundary of boundaries(snapshot.root)) {
    const shape = shapeOf(boundary, layout, undefined, declared);

    const entry = accumulated.get(boundary.component) ?? {
      structure: [],
      semantics: [],
      text: [],
      style: [],
      geometry: [],
      boxes: [],
      values: new Map<string, Set<string>>(),
    };
    entry.structure.push(shape.structure);
    entry.semantics.push(shape.semantics);
    entry.text.push(shape.text);
    entry.style.push(shape.style);
    entry.geometry.push(shape.geometry);
    entry.boxes.push(shape.box);
    for (const [property, values] of Object.entries(shape.values ?? {})) {
      const seen = entry.values.get(property) ?? new Set<string>();
      for (const value of values) seen.add(value);
      entry.values.set(property, seen);
    }
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
      // Under a profile with no layout every entry is `null`, and a list of
      // nulls is a measurement nobody took written as one they did. Absent
      // instead, which is the same rule `geometry` above obeys.
      ...(layout ? { boxes: entry.boxes } : {}),
      values: sortedValues(entry.values),
    }))
    // Code-unit order, not `localeCompare`. The doc above promises byte-identical
    // output for an unchanged subject, and a locale-aware comparison makes that a
    // promise about the machine's `LANG` — which was tolerable while these were
    // internal and is not now that they are written into a sidecar, committed
    // beside a baseline, and read back on someone else's runner.
    .sort((a, b) => byCodeUnit(a.component, b.component));
}

/** Properties and their values in code-unit order, so the sidecar is byte-stable. */
function sortedValues(values: ReadonlyMap<string, ReadonlySet<string>>): Record<string, string[]> {
  const sorted: Record<string, string[]> = {};
  for (const property of [...values.keys()].sort(byCodeUnit)) {
    sorted[property] = [...values.get(property)!].sort(byCodeUnit);
  }
  return sorted;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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

/**
 * Which bands moved, kept per component instead of folded into one list.
 *
 * {@link bandsBetween} answers *what kind of change is in this subject*, which is
 * the question a sensitivity level asks. It cannot answer the one a reviewer
 * asks — *what changed, and where* — because the fold is lossy in exactly the
 * place attribution lives: a subject reporting `content, geometry, token` has
 * told you a colour and a string and a size all moved somewhere in it, and left
 * you to guess which of the forty components on the page owns which.
 *
 * Unfolded, the same two sidecars say `Button — geometry, token` and
 * `CardFooter — a11y, content`, and that is a sentence a page can print beside a
 * picture. It is also the record that survives when the raster tier loses the
 * name: a difference that reflowed its neighbours merges into one blob whose box
 * fits no component, so the region resolves to the document root and the edit
 * arrives unattributed — while the hashes, which never looked at a pixel, still
 * hold the component that moved and the sense in which it moved.
 *
 * `cause` repeats the {@link causesBetween} predicate rather than being derived
 * from `bands`, and the repetition is the point: `structure` and `geometry` both
 * map to the `geometry` band, so a component that edited its own tree and one
 * that was merely pushed by a neighbour are indistinguishable *after* the band
 * mapping. Losing that here would make every reflowed container a culprit.
 */
export interface ComponentBands {
  readonly component: string;
  /** Non-empty: a component whose digests all matched has no entry at all. */
  readonly bands: readonly Band[];
  /** Its own content moved, as opposed to only its rect. `causesBetween`'s test. */
  readonly cause: boolean;
  /** Set only when the component is on one side alone, which `bands` cannot say. */
  readonly presence?: 'added' | 'removed';

  /**
   * How much bigger its own box got, when every instance agrees on the answer.
   *
   * The band a reviewer actually wanted. `geometry` says a rect under here is
   * not the rect it was; this says the control is eight pixels taller and
   * thirty-six wider, which is the padding somebody edited, arriving as a
   * measurement rather than as a guess about which property produced it.
   *
   * Absent for four different reasons and they are one reason: nobody can say.
   * No boxes on one side, a different number of instances, instances that
   * disagree about the delta, or a box that did not change size. Present is
   * always non-zero on at least one axis.
   */
  readonly grew?: { readonly width: number; readonly height: number };

  /**
   * Which declared values changed, by property, when both sides recorded them.
   *
   * `token` says a declaration under here moved; this names it. `from` holds the
   * values only the baseline had and `to` the values only this run has, so a
   * component rendered as primary and secondary that changed one background
   * reports that background and not the other. An empty side is a property no
   * node declared on that side, which was measured and is not the same as absent.
   *
   * Absent when either sidecar predates the record, and when the style digest
   * moved but no property's set of values did — a value that moved from one
   * node to another is a real change this cannot describe, and an empty list
   * would say there was none. Present is never empty.
   */
  readonly changed?: readonly ValueChange[];
}

/** One property whose set of declared values differs between two revisions. */
export interface ValueChange {
  readonly property: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

/**
 * Every component whose hashes differ, with the bands it differs in.
 *
 * One-sided components contribute `geometry` and nothing else, which is
 * {@link bandsBetween}'s rule and must stay identical to it: a component that is
 * simply not there did not rename anything, and inflating the answer would put
 * an `a11y` claim on a page for a component nobody can look at. `presence` is
 * what carries the rest of that meaning, so no reader has to infer *appeared*
 * from a lone `geometry`.
 *
 * `(unattributed)` is excluded for the reason {@link causesBetween} excludes it:
 * it is a bucket for nodes whose provenance chain broke, so it collects
 * unrelated parts of a page under one name and nothing downstream could act on
 * it. The broken chain is reported where it means something, not here as a
 * component that moved.
 */
export function movedBandsBetween(
  before: readonly ComponentHash[],
  after: readonly ComponentHash[],
): readonly ComponentBands[] {
  const previous = new Map(before.map((entry) => [entry.component, entry]));
  const present = new Set(after.map((entry) => entry.component));
  const moved: ComponentBands[] = [];

  for (const entry of after) {
    if (entry.component === UNATTRIBUTED) continue;
    const was = previous.get(entry.component);
    if (was === undefined) {
      moved.push({ component: entry.component, bands: ['geometry'], cause: true, presence: 'added' });
      continue;
    }
    const bands = movedBands(was, entry);
    if (bands.length === 0) continue;
    const grew = grewBetween(was.boxes, entry.boxes);
    const changed = was.style === entry.style ? undefined : changedBetween(was.values, entry.values);
    moved.push({
      component: entry.component,
      bands,
      cause: ownContentMoved(was, entry),
      ...(grew === undefined ? {} : { grew }),
      ...(changed === undefined ? {} : { changed }),
    });
  }

  for (const entry of before) {
    if (entry.component === UNATTRIBUTED) continue;
    if (present.has(entry.component)) continue;
    moved.push({ component: entry.component, bands: ['geometry'], cause: true, presence: 'removed' });
  }

  return moved.sort((left, right) => byCodeUnit(left.component, right.component));
}

/**
 * Every property whose values differ, or nothing when that cannot be said.
 *
 * Read only when the `style` digest moved, which is the digest these values
 * were declared into: a component whose declarations hashed the same has
 * nothing here to name, whatever else about it changed.
 */
function changedBetween(
  before: ComponentHash['values'],
  after: ComponentHash['values'],
): readonly ValueChange[] | undefined {
  if (before === undefined || after === undefined) return undefined;

  const changed: ValueChange[] = [];
  const properties = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const property of [...properties].sort(byCodeUnit)) {
    const was = before[property] ?? [];
    const now = after[property] ?? [];
    const from = was.filter((value) => !now.includes(value));
    const to = now.filter((value) => !was.includes(value));
    if (from.length > 0 || to.length > 0) changed.push({ property, from, to });
  }
  return changed.length === 0 ? undefined : changed;
}

/**
 * One size delta both sides agree on, or nothing.
 *
 * Instances are paired by document order, which is the only order either side
 * has. That pairing is sound exactly while the counts match: a component that
 * gained an instance shifted every index after the insertion, and the deltas
 * that fell out would be measurements of one instance against a different one.
 * So a changed count answers nothing rather than answering wrongly — the count
 * itself already moved `structure`, and the reviewer is told that instead.
 *
 * Instances that disagree also answer nothing. Three buttons where one grew and
 * two did not is a real finding and it is not *this* one, and printing the first
 * or the largest would be the page picking a representative and not saying so.
 *
 * Position is deliberately not read. Everything below a control that got taller
 * moved down, and a delta drawn from `x`/`y` would name every one of them.
 */
function grewBetween(
  before: readonly (Rect | null)[] | undefined,
  after: readonly (Rect | null)[] | undefined,
): { readonly width: number; readonly height: number } | undefined {
  if (before === undefined || after === undefined) return undefined;
  if (before.length === 0 || before.length !== after.length) return undefined;

  let agreed: { width: number; height: number } | undefined;
  for (const [index, was] of before.entries()) {
    const now = after[index];
    if (was === null || was === undefined || now === null || now === undefined) return undefined;

    const width = now.width - was.width;
    const height = now.height - was.height;
    if (agreed === undefined) agreed = { width, height };
    else if (agreed.width !== width || agreed.height !== height) return undefined;
  }

  return agreed === undefined || (agreed.width === 0 && agreed.height === 0) ? undefined : agreed;
}
