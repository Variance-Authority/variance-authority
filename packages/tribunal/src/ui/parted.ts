/**
 * Where one change's renders stopped agreeing with each other.
 *
 * A change is approved once and lands many times. `Button` moved in seven
 * renders and the page says so, which reads as one thing having happened seven
 * times — and on this build it is two things. Two of those renders moved by
 * 6,418 pixels into one shape and five moved by about 3,500 into another, so a
 * reviewer pressing approve is signing off on two outcomes under one name and
 * has been shown neither.
 *
 * The shape is already recorded: a region carries a fingerprint of the
 * difference, so renders that moved *identically* share one and renders that
 * absorbed the same edit differently do not. Grouping by it costs nothing and
 * turns `7 renders · 2 shapes` — a count nobody can act on — into the two groups
 * and what separates them.
 *
 * ## Not `partingOf`
 *
 * `@variance-authority/core`'s parting reads two documents and climbs to the
 * hook cell that decided a difference. This never opens a document. It divides
 * one component's renders by the digest of what happened to each, which is the
 * same question — *where did these part* — asked at the only grain a review
 * surface has, and answerable on data the build already carried.
 *
 * ## The shared name is a name, not a cause
 *
 * When every subject in a group extends one prefix and no other group's does,
 * that prefix is printed. It is the inference `VariationRecord`'s `named`
 * already makes — a subject whose name extends another's is that subject plus an
 * axis — and it is correct exactly as often as the naming convention is kept. So
 * it is printed as a label beside the group and never as a because: *these two
 * are the `route/detail` renders*, not *`route/detail` caused this*.
 *
 * One shape is reported too. *Seven renders, one shape* is the answer that makes
 * the divided case legible, and a section that appeared only on divergence would
 * leave a reviewer unable to tell agreement from a panel that had not loaded.
 */

import type { Appearance, Origin } from './grouping.js';

/** One group of renders that moved identically. */
export interface Shape {
  /** The fingerprint they share. Not printed; it is an identity, not a finding. */
  readonly shape: string;
  /** Subjects in it, sorted. */
  readonly renders: readonly string[];
  readonly least: number;
  readonly most: number;
  /**
   * The name every render here extends and no other group's does.
   *
   * Absent when the group has one render — the subject is already the coordinate
   * — or when the names have nothing in common that is theirs alone.
   */
  readonly only?: string;
}

/** One change's renders, divided by what happened to each. */
export interface Parted {
  readonly shapes: readonly Shape[];
  /**
   * Renders whose leading region recorded no fingerprint.
   *
   * Their own list, never a shape. Two renders that both recorded nothing have
   * not been found to agree, and folding them together would report the
   * identical difference twice about a pair nothing measured.
   */
  readonly unshaped: readonly string[];
}

export function partedBy(origin: Origin): Parted {
  const groups = new Map<string, Appearance[]>();
  const unshaped: string[] = [];

  for (const each of origin.appearances) {
    if (each.shape === undefined) {
      unshaped.push(each.subject.subject);
      continue;
    }
    groups.set(each.shape, [...(groups.get(each.shape) ?? []), each]);
  }

  const found = [...groups].map(([shape, members]) => {
    const pixels = members.map((each) => each.pixels);
    return {
      shape,
      renders: members.map((each) => each.subject.subject).sort(),
      least: Math.min(...pixels),
      most: Math.max(...pixels),
    };
  });

  const shapes = found
    .map((group) => {
      const only = nameOf(
        group.renders,
        found.filter((other) => other.shape !== group.shape).flatMap((other) => other.renders),
      );
      return only === undefined ? group : { ...group, only };
    })
    .sort((left, right) => right.most - left.most || left.shape.localeCompare(right.shape));

  return { shapes, unshaped: unshaped.sort() };
}

/** Boundaries a subject name is built from, so a prefix is cut at a joint. */
const JOINTS = new Set(['/', '@', ':', '-', '.', '_']);

/**
 * The name these renders share, when no other group's renders share it.
 *
 * `undefined` for a single render, where the prefix would be the subject itself
 * and printing it beside the subject says nothing twice.
 *
 * The common prefix is only a name when it ends where the renders do — at a
 * joint, or at the end of one of them. `route/detail@1280` and
 * `route/detail@1024` have `route/detail@1` in common and no such viewport
 * exists; the name is `route/detail`, which is then shared with the other group
 * and so is not printed at all.
 */
function nameOf(renders: readonly string[], others: readonly string[]): string | undefined {
  if (renders.length < 2) return undefined;

  const [first = '', ...rest] = renders;
  let cut = first.length;
  for (const each of rest) {
    let index = 0;
    while (index < cut && index < each.length && each[index] === first[index]) index += 1;
    cut = index;
  }

  if (!renders.every((each) => each.length === cut || JOINTS.has(each[cut] ?? ''))) {
    while (cut > 0 && !JOINTS.has(first[cut - 1] ?? '')) cut -= 1;
  }
  while (cut > 0 && JOINTS.has(first[cut - 1] ?? '')) cut -= 1;
  const shared = first.slice(0, cut);
  if (shared === '') return undefined;

  return others.some((each) => each.startsWith(shared)) ? undefined : shared;
}
