import type { Band } from '../compare/band.js';
import type { ChangedComponent, Delta, Root, RootKind, SemanticDiff } from '../compare/diff/index.js';
import { aggregateImpact, type AggregateImpact, type PropertyImpact } from '../compare/impact.js';

/**
 * The docket: one entry per root cause, across every subject in a change set.
 *
 * A `SemanticDiff` answers "what changed in this subject". That is the wrong unit
 * for review, and reviewing at that unit is what makes visual regression
 * unbearable — one design-token edit arrives as three hundred separate subjects
 * to click through, and the three-hundred-and-first gets approved without being
 * read.
 *
 * The docket inverts it. One token edit is **one entry**, carrying the count of
 * what it reached. Spec §6.2 requires that approving it be a single action, which
 * is only possible if the thing being approved is the cause rather than each of
 * its effects.
 *
 * Aggregation is by root **id**, which is why root ids are constructed to be
 * stable across subjects: `token:--color-primary` is the same root wherever it
 * lands, so the grouping needs no similarity heuristic.
 */

export interface DocketEntry {
  readonly rootId: string;
  readonly kind: RootKind;
  readonly label: string;
  readonly band: Band;
  readonly impact: AggregateImpact;

  /** Subjects this root reached, in first-seen order. */
  readonly subjects: readonly string[];
  readonly subjectCount: number;
  /** Individual deltas across all subjects — the collateral count. */
  readonly deltaCount: number;

  readonly components: readonly ChangedComponent[];

  /**
   * A few subjects to actually look at.
   *
   * Mass re-baselining is only survivable if approval is *informed*, and nobody
   * informs themselves by reviewing three hundred identical diffs. Spec §7.3 asks
   * for a sampled spot-check list, and this is it.
   */
  readonly sample: readonly string[];

  /**
   * Distinct places this root's changes were observed, most common first.
   *
   * Carried on the entry rather than derived from deltas at report time, because
   * an entry spans subjects and the deltas behind it are not kept. Three is
   * enough to orient without turning a collapsed root back into a list — the
   * thing collapsing it was for.
   */
  readonly places: readonly string[];

  /**
   * `true` when nothing under this root added, removed, moved, or renamed a node.
   *
   * The other half of the sentence the product promises. "One token change, 300
   * collateral" is only reassuring alongside "structure intact" — that is what
   * makes it a one-action approval rather than three hundred things to check.
   */
  readonly structureIntact: boolean;
}

export interface Docket {
  readonly entries: readonly DocketEntry[];
  readonly subjectsCompared: number;
  readonly subjectsUnchanged: number;
  readonly subjectsChanged: number;

  /**
   * `true` when every change in the set has one explanation.
   *
   * The condition under which the whole review collapses to a single action.
   */
  readonly singleRoot: boolean;
}

export interface DocketOptions {
  /** Subjects listed per entry for spot-checking. Policy, not a constant. */
  readonly sampleSize?: number;
}

export function buildDocket(
  diffs: readonly SemanticDiff[],
  options: DocketOptions = {},
): Docket {
  const sampleSize = options.sampleSize ?? 3;
  const groups = new Map<string, Accumulator>();

  for (const diff of diffs) {
    if (diff.identical) continue;

    for (const root of diff.roots) {
      const entry = groups.get(root.id) ?? newAccumulator(root);
      groups.set(root.id, entry);

      entry.subjects.add(diff.subjectId);
      entry.deltas.push(...root.deltas);
      for (const component of componentsUnder(root, diff.components)) {
        mergeComponent(entry.components, component);
      }
    }
  }

  const entries = [...groups.values()]
    .map((entry) => finalize(entry, sampleSize))
    // Widest blast radius first: a root touching forty subjects is the review,
    // and one touching a single subject is a detail underneath it.
    .sort((a, b) => b.subjectCount - a.subjectCount || b.deltaCount - a.deltaCount);

  const changed = diffs.filter((diff) => !diff.identical).length;

  return {
    entries,
    subjectsCompared: diffs.length,
    subjectsUnchanged: diffs.length - changed,
    subjectsChanged: changed,
    singleRoot: entries.length === 1,
  };
}

/**
 * The docket as one sentence per entry.
 *
 * Deliberately terse. The audience is a reviewer deciding whether to look
 * further and an agent deciding whether to act, and both are worse served by a
 * paragraph than by a line they can scan.
 */
export function summarize(docket: Docket): string {
  if (docket.entries.length === 0) {
    return `${docket.subjectsCompared} subjects compared, nothing changed.`;
  }

  const header =
    `${docket.subjectsChanged} of ${docket.subjectsCompared} subjects changed, ` +
    `explained by ${docket.entries.length} root${docket.entries.length === 1 ? '' : 's'}.`;

  const lines = docket.entries.map((entry) => {
    const reach =
      entry.subjectCount === 1
        ? `${entry.deltaCount} change${entry.deltaCount === 1 ? '' : 's'}`
        : `${entry.subjectCount} subjects, ${entry.deltaCount} collateral`;

    const structure = entry.structureIntact ? 'structure intact' : 'structure changed';
    const components =
      entry.components.length > 0
        ? ` — ${entry.components
            .slice(0, 4)
            .map((component) => component.name)
            .join(', ')}`
        : '';

    return (
      `  ${entry.kind}: ${entry.label} — ${reach}, ${entry.band}/${entry.impact}, ` +
      `${structure}${components}`
    );
  });

  return [header, ...lines].join('\n');
}

interface Accumulator {
  readonly root: Root;
  readonly subjects: Set<string>;
  readonly deltas: Delta[];
  readonly components: Map<string, MutableComponent>;
}

interface MutableComponent {
  name: string;
  role: 'root' | 'collateral';
  deltaCount: number;
  bands: Set<Band>;
  impacts: (PropertyImpact | 'structural')[];
  renderedIn: Set<string>;
}

function newAccumulator(root: Root): Accumulator {
  return { root, subjects: new Set(), deltas: [], components: new Map() };
}

function finalize(entry: Accumulator, sampleSize: number): DocketEntry {
  const subjects = [...entry.subjects];

  return {
    rootId: entry.root.id,
    kind: entry.root.kind,
    label: entry.root.label,
    band: entry.deltas.some((delta) => delta.band === 'geometry') ? 'geometry' : entry.root.band,
    impact: aggregateImpact(entry.deltas.map((delta) => delta.impact ?? 'structural')),
    subjects,
    subjectCount: subjects.length,
    deltaCount: entry.deltas.length,
    components: [...entry.components.values()]
      .map((component) => ({
        name: component.name,
        role: component.role,
        deltaCount: component.deltaCount,
        bands: [...component.bands],
        impact: aggregateImpact(component.impacts),
        renderedIn: [...component.renderedIn],
      }))
      .sort((a, b) => b.deltaCount - a.deltaCount || a.name.localeCompare(b.name)),
    sample: subjects.slice(0, sampleSize),
    places: rankedPlaces(entry.deltas),
    structureIntact: !entry.deltas.some(isStructural),
  };
}

/** Distinct `where` phrases, most frequent first, capped. */
function rankedPlaces(deltas: readonly Delta[]): readonly string[] {
  const counts = new Map<string, number>();

  for (const delta of deltas) {
    if (delta.where === undefined || delta.where === '') continue;
    counts.set(delta.where, (counts.get(delta.where) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([where]) => where);
}

/**
 * Whether a delta changed the shape of the tree rather than a value.
 *
 * A `rect-changed` that was *derived* from a style change does not count: the
 * box moved because a value moved, and calling that a structural change would
 * make every spacing token look like it rearranged the page.
 */
function isStructural(delta: Delta): boolean {
  switch (delta.kind) {
    case 'node-added':
    case 'node-removed':
    case 'node-moved':
    case 'role-changed':
    case 'name-changed':
    case 'text-changed':
      return true;
    case 'rect-changed':
      return delta.derivedFrom === undefined;
    default:
      return false;
  }
}

/** Components that appear in this root's deltas, from the subject's own view. */
function componentsUnder(
  root: Root,
  components: readonly ChangedComponent[],
): readonly ChangedComponent[] {
  const names = new Set<string>();
  for (const delta of root.deltas) {
    for (const owner of delta.owners ?? []) names.add(owner.name);
  }
  return components.filter((component) => names.has(component.name));
}

function mergeComponent(
  into: Map<string, MutableComponent>,
  component: ChangedComponent,
): void {
  const existing = into.get(component.name);

  if (!existing) {
    into.set(component.name, {
      name: component.name,
      role: component.role,
      deltaCount: component.deltaCount,
      bands: new Set(component.bands),
      impacts: [],
      renderedIn: new Set(component.renderedIn),
    });
    return;
  }

  existing.deltaCount += component.deltaCount;
  for (const band of component.bands) existing.bands.add(band);
  for (const parent of component.renderedIn) existing.renderedIn.add(parent);
  // Root in any subject means root: a component that changed internally
  // somewhere is a cause, even if elsewhere it was only along for the ride.
  if (component.role === 'root') existing.role = 'root';
}
