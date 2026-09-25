/**
 * The walk, joined to what each planned subject's baseline said it was made of.
 *
 * Kept beside [`reach.ts`](./reach.ts) rather than inside it because the join is
 * a different question. That file answers *what does this diff reach*, which is
 * a fact about source and needs nothing but a graph. This one answers *could
 * this commit have moved this picture*, which needs the other half — what a
 * browser recorded a subject as being made of — and is the only thing here that
 * reads a baseline at all.
 */

import type { ReachReport, SubjectReach } from '@variance-authority/report';
import type { BeforeReach, Relations } from '@variance-authority/core/relate';

import { NO_INSTALL_DIFF, type InstallDiff } from './installed.js';
import { affectedComponents, listed, many, refused, type MovedExports } from './reach.js';

export interface ReachInput {
  /** The ref the diff was taken against, in the operator's own words. */
  readonly against: string;
  readonly changed: readonly string[];
  readonly changedDirs?: readonly string[];
  readonly relations: Relations;
  readonly roots: readonly string[];

  /**
   * What the run rests on before any test imports it, when entry points were
   * declared. Absent is *none were*, and the left end of the line stays as
   * invisible as it has always been.
   */
  readonly before?: BeforeReach;

  /**
   * What the diff did to the install, when the lockfile could be read at both
   * revisions. Absent is *no reading was taken*, which seeds no package and
   * leaves every manifest in the diff a changed file, exactly as before.
   */
  readonly install?: InstallDiff;

  /**
   * What each changed file moved for its importers, read from both texts. A
   * file that moved nothing seeds nothing. Absent is *no reading was taken*.
   */
  readonly movedExports?: MovedExports;

  /**
   * Component names each planned subject's stored baseline recorded.
   *
   * `undefined` for a subject with no baseline, and for one whose baseline
   * predates the field. Neither is a key in the answer: the run does not know
   * what that subject is made of, so it cannot say what reaches it, and a
   * `reached: false` written from an absent list would be an assertion nobody
   * made.
   */
  readonly baselines: ReadonlyMap<string, readonly string[] | undefined>;
}

/**
 * The reach section of the report: the walk, joined to what each baseline said
 * its subject was made of.
 *
 * The join is the point. A graph alone says which components an edit reaches,
 * which is a fact about source. A baseline alone says which components a subject
 * rendered, which is a fact about a browser. Only together do they say whether
 * this commit could have moved this picture — and that is the sentence that makes
 * a green subject and a red one interesting for opposite reasons.
 */
export function reachOf(input: ReachInput): ReachReport {
  const { against, changed, relations, roots, baselines } = input;
  const walk = affectedComponents(
    relations,
    changed,
    input.changedDirs ?? [],
    roots,
    input.install ?? NO_INSTALL_DIFF,
    input.before,
    input.movedExports ?? new Map(),
  );

  if (refused(walk)) {
    return {
      against,
      changed,
      components: [],
      whole: walk.whole,
      ...(walk.unscanned === undefined ? {} : { unscanned: walk.unscanned }),
    };
  }

  const trails = new Map(walk.components.map((entry) => [entry.component, entry.trail]));
  const subjects: Record<string, SubjectReach> = {};

  for (const [subject, components] of baselines) {
    if (components === undefined) continue;

    const through = components.filter((component) => trails.has(component)).sort(byCodeUnit);
    const first = through[0];

    if (first === undefined) {
      subjects[subject] = {
        reached: false,
        through: [],
        because:
          `its baseline records ${many(components.length, 'component')} and this diff reaches ` +
          'none of them',
      };
      continue;
    }

    subjects[subject] = {
      reached: true,
      through,
      trail: trails.get(first)!,
      because:
        `this diff reaches ${listed(through)}, which its baseline records among ` +
        `${many(components.length, 'component')}`,
    };
  }

  return {
    against,
    changed,
    components: walk.components,
    subjects,
  };
}
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
