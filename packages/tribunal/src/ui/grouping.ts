/**
 * The changes, grouped by what caused them — which is the unit a reviewer acts on.
 *
 * Nobody approves a screenshot. A person looking at twenty changed renders is
 * looking at *one* edit to `Button` twenty times, and the category ships that as
 * twenty decisions: twenty thumbnails, twenty approve buttons, and no way to say
 * the thing that is actually true — *yes, I meant to restyle the button, and yes,
 * every card that grew by two millimetres grew because of it.*
 *
 * So the review item here is the origin, and a subject is a place it showed up.
 *
 * ## Three records meet on one group, and none of them can carry it alone
 *
 * - **The diff** says the commit reaches this component, and by what chain. An
 *   origin the commit does not reach is the strongest signal on the page: nothing
 *   you wrote arrives here and it moved anyway.
 * - **The fingerprint** says whether they moved *the same way* — the shape with
 *   position and values removed. It does not decide the group and must not: a
 *   shape is a pixel digest, so one restyle lands as one shape on the buttons
 *   that are the same size and another on the one that is not. It answers the
 *   question after the group, which is which of these differences recur — and a
 *   shared shape is the set `variance accept --shape` takes.
 * - **The record** says whether this component moves all the time or has been
 *   still since March. A 2px shift in a component that has caused an approved
 *   change in nineteen of twenty runs is a different decision from the same 2px in
 *   one that has caused none.
 *
 * ## What is not claimed
 *
 * Collateral is **not** attributed to an origin. Deciding which edit pushed which
 * box around is exactly the attribution the semantic tier declined to make, and a
 * group that swallowed it would be inventing the one number nobody measured. What
 * a member carries instead is the list of components that moved *with* it in that
 * subject, which is an observation rather than a claim.
 *
 * Apart from [`origins.tsx`](./origins.tsx), which draws all of this: the
 * question *what is a change* is decided here and answered in one place, and the
 * panel that renders it is long enough on its own.
 */

import type { BuildDetail, SubjectView } from '../review-types.js';
import { leadOf } from './lead.js';
import { count, number } from './text.js';

/** One subject an origin showed up in. */
export interface Appearance {
  readonly subject: SubjectView;
  /** Pixels the origin's own cause region moved here. */
  readonly pixels: number;
  /** The shape of that region, when the run recorded one. */
  readonly shape?: string;
  /** Other components with regions in this subject — observed, not attributed. */
  readonly alongside: readonly string[];
}

export interface Origin {
  readonly component: string;
  /** Where the component is declared, from the build's own docket. */
  readonly file?: string;
  readonly pixels: number;
  readonly appearances: readonly Appearance[];
  /** How the commit arrives at this component, when a diff was read. */
  readonly trail?: readonly string[];
  /** `undefined` when the run carried no diff, which is not the same as `false`. */
  readonly reached?: boolean;
  /**
   * What the commit *does* reach in the renders this origin showed up in.
   *
   * The same relation as `SubjectReach.through`, unioned over this origin's
   * appearances, and it is here for the case `reached === false` cannot describe
   * on its own. A component the diff does not reach, moving in a render the diff
   * reaches through three other components, is an ordinary Tuesday — most of a
   * page belongs to libraries the import graph was never asked about. Without
   * this the panel had one sentence for that and for a genuine orphan, and it
   * spent it on the orphan.
   */
  readonly through?: readonly string[];
  /**
   * Renders this origin showed up in that the commit reaches nothing in at all.
   *
   * Empty is the common case and the whole point of separating it: a difference
   * with no path from the diff to any component in the render is the finding
   * worth waking somebody for, and it is worth nothing if it is printed over
   * every third-party component on the page as well.
   */
  readonly stranded?: readonly string[];
}

export interface Origins {
  readonly origins: readonly Origin[];
  /**
   * Changed subjects no component claimed.
   *
   * Their own bucket, never folded into an origin. A subject that moved with
   * nothing named as its cause is the one case where a reviewer has to open the
   * picture, and hiding it inside a group would hand them somebody else's edit to
   * approve it under.
   */
  readonly unattributed: readonly SubjectView[];
}

export function originsOf(build: BuildDetail): Origins {
  const files = new Map(build.causes.map((cause) => [cause.component, cause.file]));
  const groups = new Map<string, { pixels: number; where: Appearance[] }>();
  const unattributed: SubjectView[] = [];

  for (const subject of build.subjects) {
    if (subject.verdict !== 'changed') continue;

    const lead = leadOf(subject);
    if (lead?.component === undefined) {
      unattributed.push(subject);
      continue;
    }

    const group = groups.get(lead.component) ?? { pixels: 0, where: [] };
    group.pixels += lead.pixels;
    group.where.push({
      subject,
      pixels: lead.pixels,
      ...(lead.fingerprint === undefined ? {} : { shape: lead.fingerprint }),
      alongside: [
        ...new Set(
          subject.regions
            .map((region) => region.component)
            .filter((name): name is string => name !== undefined && name !== lead.component),
        ),
      ].sort(),
    });
    groups.set(lead.component, group);
  }

  const reach = build.reach !== null && build.reach.whole === undefined ? build.reach : null;

  const origins = [...groups.entries()]
    .map(([component, group]): Origin => {
      const file = files.get(component);
      const entry = reach?.components.find((each) => each.component === component);
      return {
        component,
        pixels: group.pixels,
        appearances: group.where,
        ...(file === undefined ? {} : { file }),
        ...(reach === null ? {} : { reached: entry !== undefined, ...around(reach, group.where) }),
        ...(entry === undefined ? {} : { trail: entry.trail }),
      };
    })
    .sort((left, right) =>
      right.pixels === left.pixels
        ? left.component.localeCompare(right.component)
        : right.pixels - left.pixels,
    );

  return { origins, unattributed };
}

/**
 * What the diff reaches around this origin, and where it reaches nothing.
 *
 * Read per appearance and then unioned, rather than asked of the component: the
 * question is not *does the commit know this name* but *does the commit arrive in
 * the pictures where this name moved*, and those have different answers exactly
 * when the answer matters.
 */
function around(
  reach: NonNullable<BuildDetail['reach']>,
  appearances: readonly Appearance[],
): { through: readonly string[]; stranded: readonly string[] } {
  const through = new Set<string>();
  const stranded: string[] = [];

  for (const { subject } of appearances) {
    const entry = reach.subjects?.[subject.subject];
    if (entry?.reached === true) for (const name of entry.through) through.add(name);
    else stranded.push(subject.subject);
  }

  return { through: [...through].sort(), stranded };
}

/**
 * What the differences look like, which is the half a component name cannot say.
 *
 * A component groups *what was edited*. A shape groups *what the edit did*, and
 * the two answer different questions: eleven appearances under `Button` with one
 * shape between them is a token that moved every button identically, and eleven
 * with nine shapes is a component whose renders each absorbed the change
 * differently. Both are one review. Only the first has a name a reviewer can
 * carry to another build.
 */
export function shapesOf(appearances: readonly Appearance[]): Map<string, number> {
  const clusters = new Map<string, number>();
  for (const each of appearances) {
    if (each.shape === undefined) continue;
    clusters.set(each.shape, (clusters.get(each.shape) ?? 0) + 1);
  }
  return clusters;
}

/**
 * How large this change is, counted in what is being decided.
 *
 * A pixel total is the figure this category leads with and the least useful one
 * available: it is one number for every size of change, and on the restyle that
 * moves everything it degenerates to a number nobody can act on. Distinct shapes
 * over the places they landed says the thing the total cannot — *one edit, seven
 * renders* is a different afternoon from *seven edits, seven renders*.
 */
export function scale(appearances: readonly Appearance[]): string {
  const shapes = shapesOf(appearances).size;
  const pixels = appearances.reduce((total, each) => total + each.pixels, 0);
  const places = `${count(appearances.length, 'region')} · ${number(pixels)} px`;

  return shapes === 0 ? places : `${count(shapes, 'change')} · ${places}`;
}
