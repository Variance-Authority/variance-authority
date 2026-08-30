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

import type { BuildDetail, MovementView, SubjectView } from '../review-types.js';
import { attributionsOf, rungAcross, type Rung } from './attribution.js';
import { leadOf } from './lead.js';

/** One subject an origin showed up in. */
export interface Appearance {
  readonly subject: SubjectView;
  /** Pixels the origin's own cause region moved here. */
  readonly pixels: number;
  /** The shape of that region, when the run recorded one. */
  readonly shape?: string;
  /** Other components with regions in this subject — observed, not attributed. */
  readonly alongside: readonly string[];
  /**
   * Why the run says it moved *here*, when the run said.
   *
   * Per appearance rather than per origin, because that is the grain the answer
   * has: one `Button` is `edited` on the page whose file the diff names and
   * `upstream` on the page where an edited parent hands it a different label.
   */
  readonly movement?: MovementView;
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
   * The rung the run put this component on, folded over its appearances.
   *
   * `undefined` is *nothing is on record* and never a sixth rung. It is what a
   * build ingested before attributions were carried answers for everything, and
   * a band that read it as `unexplained` would print a missing input as the
   * loudest finding on the page.
   */
  readonly cause?: Rung;
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
  /**
   * Renders this origin showed up in that the reach record says nothing about.
   *
   * Split out of {@link Origin.stranded}, and the split is not pedantry. A report
   * that carried component-level reach and no per-subject block put every one of
   * its renders in the unreached pile, and the panel spent its loudest sentence —
   * *the commit reaches nothing at all in this render* — on the ordinary fact
   * that nobody wrote the row down. Absent is not empty.
   */
  readonly unlisted?: readonly string[];
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
  const attributed = attributionsOf(build);
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
    const movement = attributed.at(lead.component, subject.subject);
    group.where.push({
      subject,
      pixels: lead.pixels,
      ...(lead.fingerprint === undefined ? {} : { shape: lead.fingerprint }),
      ...(movement === undefined ? {} : { movement }),
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
      // Folded over the renders this origin showed up in, not over every render
      // in the build. A component that also moved somewhere this docket does not
      // group it under moved there for its own reason, and letting that vote
      // would band this change by a page the reviewer is not looking at.
      const cause = rungAcross(group.where.flatMap((each) => each.movement ?? []));
      return {
        component,
        pixels: group.pixels,
        appearances: group.where,
        ...(cause === undefined ? {} : { cause }),
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
 *
 * Three piles, not two. A render the reach record has no row for is not a render
 * the commit fails to reach — it is a render nobody asked about — and folding
 * those together is how a report with no per-subject block ends up printing the
 * page's loudest sentence over every change in the build.
 */
function around(
  reach: NonNullable<BuildDetail['reach']>,
  appearances: readonly Appearance[],
): { through: readonly string[]; stranded: readonly string[]; unlisted: readonly string[] } {
  const through = new Set<string>();
  const stranded: string[] = [];
  const unlisted: string[] = [];

  for (const { subject } of appearances) {
    const entry = reach.subjects?.[subject.subject];
    if (entry === undefined) unlisted.push(subject.subject);
    else if (entry.reached) for (const name of entry.through) through.add(name);
    else stranded.push(subject.subject);
  }

  return { through: [...through].sort(), stranded, unlisted };
}

/**
 * The names the run put on this change's cause, for the row to print.
 *
 * The rail used to carry a paragraph per band saying what the band meant — *a
 * component the commit did edit draws each one and hands it what it renders* —
 * while the name of the component that did the drawing sat in the record,
 * unprinted, and the file a component is declared in sat in a `title` attribute
 * nobody hovers. That is backwards twice: the definition is identical on every
 * build, and the name is the only part that is about this one.
 *
 * So the paragraph is gone and this stands where it stood. Per rung, because
 * each rung recorded a different kind of evidence and there is no general one:
 * `edited` has the file the diff named, `token` has the custom properties that
 * took new values, `upstream` has the edited component that reaches this one and
 * the chain it reaches through.
 *
 * Folded over the appearances rather than read off the first, and the difference
 * is the case worth having. One `CardFooter` can be handed its change by
 * `ProductCard` on the product page and by `CartCard` on the cart, and a row
 * printing whichever render came back first would name a page the reviewer is
 * not looking at.
 */
export function sourceOf(origin: Origin): readonly string[] {
  const found = new Set<string>();

  for (const { movement } of origin.appearances) {
    if (movement === undefined) continue;
    if (movement.cause === 'edited' && movement.file !== undefined) found.add(movement.file);
    if (movement.cause === 'token') for (const token of movement.tokens ?? []) found.add(token);
    if (movement.cause === 'upstream' && movement.upstream !== undefined) {
      found.add([movement.upstream, ...(movement.through ?? [])].join(' → '));
    }
  }

  // Where the component is declared, when no movement named anything — which is
  // most of what the `title` attribute was hiding, and is the answer a reviewer
  // opening an unattributed row is about to go looking for anyway.
  if (found.size === 0 && origin.file !== undefined) found.add(origin.file);

  return [...found].sort();
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
