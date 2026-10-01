import type { ObservationRecord, RegionRecord } from './format.js';

/**
 * A run's changes, grouped into the *distinct things that happened*.
 *
 * ## The unit of review is wrong by default
 *
 * Every tool in this category hands a reviewer a list of screenshots, and a
 * reviewer's actual question is not "is this screenshot acceptable". It is *what
 * changed, and how many places did it land*. A design-token edit that touches 40
 * stories is one decision presented as forty, and the fortieth is approved
 * without being looked at — which is the mechanism by which large suites stop
 * being reviewed at all.
 *
 * Argos groups by the shape of the pixel diff and calls the group a **change**,
 * ranked by recurrence
 * ([test page](https://argos-ci.com/docs/learn/reliability-and-flakiness/test-page.md)).
 * Applitools clusters by diff-region shape so one accept propagates across the
 * batch. This project has had the *fingerprints* since 2026-08-05 and printed
 * them one region at a time — [`compare-visual-review.md`](../../../docs/compare-visual-review.md)
 * states the gap in as many words: they group the batch for you, and here the
 * operator copies one digest out of a report.
 *
 * This is the grouping. It needs nothing new: a fingerprint is already on every
 * region, so a cluster is a `groupBy` and an ordering. The component is not part
 * of the key. It sits beside the fingerprint on the region, and a cluster adopts
 * the first one it finds (see `name`).
 *
 * ## What the fingerprint is
 *
 * `mask-fingerprint` hashes the *silhouette* of a red diff mask — bounding box,
 * dilated, resampled onto a 16×16 grid, density quantized to four buckets. That
 * is translation- and scale-invariant, which is the point, and it is also blind
 * to what changed: two different edits occupying the same box collide, and an
 * ignore scoped to one of them silences the other. Their own docs concede a
 * version of this while a neighbouring page claims it cannot happen.
 *
 * The fingerprint on a region is the same kind of digest: `fingerprintOfMask`
 * in `core/judge`, which `decide` in `@variance-authority/observe` computes from
 * the change mask and the region's box alone — the mask cropped to the box and
 * resampled onto a 12×12 grid, with the aspect ratio and the linear size
 * bucketed beside it. The size bucket is the one difference: it is not
 * scale-free, so a small flaky badge does not share a digest with a large card
 * that went solid. It is equally blind to who drew the pixels. The same-looking
 * change in `Avatar` and in `Badge` is one cluster, and `accept --shape` on it
 * promotes both.
 *
 * The semantic fingerprint, `fingerprintOfRoot`, does include the component.
 * It is computed from two documents and scopes semantic-tier ignores; no region
 * carries it, so it never reaches this grouping.
 */

export interface Change {
  /** The shape digest. What `variance accept --shape` and an ignore both take. */
  readonly fingerprint: string;

  /**
   * The component of the first region in this cluster that was attributed to one.
   *
   * Beside the fingerprint, not inside it: every cluster is grouped by
   * silhouette, and regions in two components can share one. Absent means no
   * region in the cluster was attributed, so nothing names the code that drew
   * it — surfaced rather than smoothed over.
   */
  readonly component?: string;

  /** A source location for the component, when one was resolved. */
  readonly file?: string;

  /** Subject ids where this shape appears at all, in report order. */
  readonly subjects: readonly string[];

  /**
   * Subjects where this shape is the **whole** change.
   *
   * The set a single decision can settle. Everywhere else, something the shape
   * does not name also moved, so accepting the shape there would promote an
   * unreviewed difference alongside a reviewed one — which is the exact way a
   * bulk-accept feature turns a gate into a recorder. `accept --shape` already
   * refuses those by name; this is the same distinction, computed before the
   * operator commits to anything.
   */
  readonly settles: readonly string[];

  /** Regions this shape accounts for, summed. */
  readonly pixels: number;

  /** `true` when the semantic tier called this shape a cause somewhere. */
  readonly cause: boolean;
}

export interface Clustering {
  /** Distinct changes, most widespread first. */
  readonly changes: readonly Change[];

  /**
   * Subjects that changed and produced no fingerprint anywhere.
   *
   * Never folded into a catch-all cluster. A subject has no shape when the run
   * read no markup for it — no semantic snapshot, so no region is attributed and
   * none carries a fingerprint — or when only its accessibility tree changed and
   * no pixel did. Retention does not decide it: the ephemeral pair and the
   * durable baseline both attribute regions from whatever snapshot the collector
   * gave. Grouping those subjects together would invent a "change" that is
   * really the absence of one. Counting them separately is what keeps the
   * headline honest: *N subjects, M changes, and K we could not group*.
   */
  readonly ungrouped: readonly string[];
}

/**
 * Group a run's changed subjects by what happened to them.
 *
 * Ordered by how many subjects a change *settles*, then by how many it touches,
 * then by pixels, then by fingerprint. The first key is the useful one: it ranks
 * by how much of the review one decision would finish, which is the question the
 * reviewer is actually asking. Ties break deterministically so two runs over the
 * same report print the same order — a docket whose ordering wobbles is one
 * nobody can diff.
 *
 * `ignored` observations are excluded along with the green ones. An absorbed
 * difference is not a change awaiting a decision; it is a decision already made,
 * and it is accounted for in the ignore register where the question *what did
 * this rule absorb* can still be asked.
 */
export function clusterChanges(observations: readonly ObservationRecord[]): Clustering {
  const byFingerprint = new Map<string, Mutable>();
  const ungrouped: string[] = [];

  for (const observation of observations) {
    if (observation.verdict !== 'changed') continue;

    const fingerprints = new Set(
      observation.regions
        .map((region) => region.fingerprint)
        .filter((fingerprint): fingerprint is string => fingerprint !== undefined),
    );

    if (fingerprints.size === 0) {
      ungrouped.push(observation.subject);
      continue;
    }

    for (const fingerprint of fingerprints) {
      const regions = observation.regions.filter((region) => region.fingerprint === fingerprint);
      const entry = byFingerprint.get(fingerprint) ?? blank(fingerprint);
      name(entry, regions);

      entry.subjects.push(observation.subject);
      // The whole change exactly when no region of this subject carries a
      // *different* shape. A region with no fingerprint counts against it: we
      // cannot say a shape explains a difference we could not name.
      if (observation.regions.every((region) => region.fingerprint === fingerprint)) {
        entry.settles.push(observation.subject);
      }
      entry.pixels += regions.reduce((total, region) => total + region.pixels, 0);
      entry.cause ||= regions.some((region) => region.cause);

      byFingerprint.set(fingerprint, entry);
    }
  }

  const changes = [...byFingerprint.values()]
    .map(
      (entry): Change => ({
        fingerprint: entry.fingerprint,
        ...(entry.component !== undefined ? { component: entry.component } : {}),
        ...(entry.file !== undefined ? { file: entry.file } : {}),
        subjects: entry.subjects,
        settles: entry.settles,
        pixels: entry.pixels,
        cause: entry.cause,
      }),
    )
    .sort(
      (a, b) =>
        b.settles.length - a.settles.length ||
        b.subjects.length - a.subjects.length ||
        b.pixels - a.pixels ||
        (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0),
    );

  return { changes, ungrouped };
}

interface Mutable {
  readonly fingerprint: string;
  component?: string;
  file?: string;
  readonly subjects: string[];
  readonly settles: string[];
  pixels: number;
  cause: boolean;
}

function blank(fingerprint: string): Mutable {
  return { fingerprint, subjects: [], settles: [], pixels: 0, cause: false };
}

/**
 * Adopt a component and a file from the first region in the cluster that has
 * them, wherever in the run that turns out to be.
 *
 * The fingerprint is a pixel silhouette and contains no component, so two
 * regions that share one can name different components, or one can name a
 * component and the other none. The first named region in report order wins.
 * When no region in the cluster names a component, the field stays absent rather
 * than borrowing one from outside the cluster.
 */
// FIXME: a cluster whose regions name two components reports only the first,
// so `component` and `file` misattribute the rest of the cluster.
function name(entry: Mutable, regions: readonly RegionRecord[]): void {
  if (entry.component !== undefined) return;

  const named = regions.find(
    (region): region is RegionRecord & { component: string } => region.component !== undefined,
  );
  if (named === undefined) return;

  entry.component = named.component;
  if (named.file !== undefined) entry.file = named.file;
}

/**
 * The clustering as the two sentences a reviewer needs before anything else.
 *
 * "40 subjects changed" is a workload. "40 subjects changed, and they are 3
 * changes" is a plan — and the difference between those two sentences is most of
 * what this module is for.
 */
export function describeClustering(clustering: Clustering, changed: number): string {
  const { changes, ungrouped } = clustering;

  if (changed === 0) return 'nothing changed';
  if (changes.length === 0) {
    return `${changed} subject(s) changed, and none of them could be grouped`;
  }

  const settled = changes.filter((change) => change.settles.length > 0).length;

  return (
    `${changed} subject(s) changed, and they are ${changes.length} distinct change(s) — ` +
    `${settled} of which can be decided in one action` +
    (ungrouped.length > 0 ? `; ${ungrouped.length} could not be grouped` : '')
  );
}
