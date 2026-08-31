/**
 * What the commit implied, set against what the run found — in both directions.
 *
 * A diff reaches subjects. That is a prediction, made before a single pixel was
 * compared: *editing `ui/button.tsx` can arrive at these sixteen*. The run then
 * compares them and finds fourteen moved. Nothing on the page has ever put those
 * two numbers next to each other, and the gap between them is the only part of a
 * build a reviewer cannot work out for themselves.
 *
 * ## The two directions fail differently
 *
 * **Reached and still** is the edit that did not land. Two `Button` stories are
 * reached by the file the commit changed, were compared against a baseline, and
 * nothing moved. Either the change does not do what its author thinks, or those
 * two variants do not exercise it — and both are worth a reviewer's minute
 * before they approve the fourteen that did move.
 *
 * **Changed and unreached** is the other way round, and it is the more serious
 * one: something moved that the commit cannot explain. It is not attributed to a
 * root, because attributing it would be the invention this module exists to
 * catch, so it is reported against the build.
 *
 * ## Excluded is not still, and uncompared is not either
 *
 * The `MainNav` stories moved by three hundred pixels and every one of them fell
 * inside a declared ignore. Filing them under *still* would tell a reviewer the
 * edit missed the component it was written for, when in fact it hit it and a
 * rule forgave it. And a subject with no baseline was never asked the question at
 * all. Three outcomes, three lists, because a single count of *did not move*
 * would be three findings averaged into one wrong one.
 */

import type { BuildDetail } from '../review-types.js';

/** One changed file's prediction, and what became of it. */
export interface Foreseen {
  /** Subjects the diff reaches through the components declared in this file. */
  readonly reached: number;
  /** Of those, the ones the run found changed. */
  readonly moved: number;
  /** Reached, compared, and nothing moved. The prediction that failed. */
  readonly still: readonly string[];
  /** Reached and moved, with every differing pixel inside a rule that forgives it. */
  readonly excluded: readonly string[];
  /** Reached and never compared — no baseline, or nothing to compare it against. */
  readonly uncompared: readonly string[];
}

/**
 * The prediction this file made, or `null` when the run made none.
 *
 * `null` covers both a build with no diff and a diff the run could not attribute
 * to subjects. Zeroes would say the file reaches nothing, which is a finding, and
 * this module must not manufacture one out of a missing input.
 */
export function foreseenBy(build: BuildDetail, file: string): Foreseen | null {
  const per = build.reach?.subjects;
  if (per === undefined) return null;

  const mine = new Set(
    (build.reach?.components ?? [])
      .filter((each) => each.trail[0] === file)
      .map((each) => each.component),
  );
  if (mine.size === 0) return null;

  const verdicts = new Map(build.subjects.map((each) => [each.subject, each.verdict]));
  const still: string[] = [];
  const excluded: string[] = [];
  const uncompared: string[] = [];
  let reached = 0;
  let moved = 0;

  for (const [subject, how] of Object.entries(per)) {
    if (!how.reached || !(how.through ?? []).some((each) => mine.has(each))) continue;
    reached += 1;

    switch (verdicts.get(subject)) {
      case 'changed':
        moved += 1;
        break;
      case 'unchanged':
        still.push(subject);
        break;
      case 'ignored':
        excluded.push(subject);
        break;
      default:
        // `new`, `incomparable`, and a subject the reach names that this build
        // has no row for. None of them answered the question.
        uncompared.push(subject);
    }
  }

  return {
    reached,
    moved,
    still: still.sort(),
    excluded: excluded.sort(),
    uncompared: uncompared.sort(),
  };
}

export function unforeseen(build: BuildDetail): readonly string[] | null {
  const per = build.reach?.subjects;
  if (per === undefined) return null;

  return build.subjects
    .filter((each) => each.verdict === 'changed' && per[each.subject]?.reached !== true)
    .map((each) => each.subject)
    .sort();
}
