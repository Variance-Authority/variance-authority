/**
 * What draws a component, when nothing the commit touched declares it.
 *
 * The build page could count these and not explain them. *Two components moved
 * that no file in this commit declares* is arithmetic over the reach walk, and
 * the reach walk goes one way: from a file the diff named, up through the files
 * that import it, to the components those files declare. Everything a changed
 * file *draws* is off that graph by construction — `ProductCard` renders `Card`,
 * `Card` renders `CardFooter`, and no number of importers arrives at
 * `CardFooter`. So the page had a true sentence with a shrug where its reason
 * should be.
 *
 * The run already wrote the other direction down. Every component in the census
 * carries the components that enclose it, folded over the whole suite, and a
 * walk up that from `CardFooter` reaches `ProductCard` in two steps — which is
 * the file the commit changed.
 *
 * ## Two constraints, and both of them are what makes the answer true
 *
 * **The census is suite-wide.** `Card.within` is every component that encloses a
 * `Card` anywhere, so an unconstrained walk out of `CardFooter` arrives at
 * `CartCard` as readily as at `ProductCard` — and `CartCard` is the cart, which
 * has no `CardFooter` in it. Every step is therefore held to the subjects the
 * component actually moved in.
 *
 * **The walk stops at the first rung the commit reaches.** Not the first
 * enclosure: `Card` encloses `CardFooter` and explains nothing, because nothing
 * in the diff arrives at `Card` either. The answer a reviewer can act on is the
 * nearest enclosure that is *also* a component the commit reaches, and the
 * components in between are the path they will read.
 *
 * ## What it will not say
 *
 * That the enclosure is the cause. It is an enclosure — the commit reaches a
 * component that draws this one, in a subject where this one moved — and that is
 * the strongest statement the two records support together. A component can be
 * drawn by an edited parent and have moved for an unrelated reason.
 */

import type { BuildDetail } from '../review-types.js';

/** A component the commit reaches, and the chain from it down to the one asked about. */
export interface Enclosure {
  readonly holder: string;
  /** Components between the two, outermost first. Empty when the holder draws it. */
  readonly through: readonly string[];
}

export type Holding =
  /** The run kept no census, so nothing here was measured. */
  | { readonly kind: 'unrecorded' }
  /** The census has no row for this name — it was never a boundary anywhere. */
  | { readonly kind: 'unlisted' }
  /** Nothing in the suite encloses it: wherever it appears, it is the outermost thing. */
  | { readonly kind: 'outermost' }
  /** Enclosed, and the commit reaches nothing that encloses it at any depth. */
  | { readonly kind: 'enclosed'; readonly within: readonly string[] }
  /**
   * Enclosed, and this build read no diff — so *reaches* has no value here.
   *
   * Apart from `enclosed`, which is a finding. With no graph to walk, every
   * component in the suite would return one, and a page saying *the commit
   * reaches none of them* on all of them would have turned a missing input into
   * a screen of alarms.
   */
  | { readonly kind: 'unmeasured'; readonly within: readonly string[] }
  /** Every nearest enclosure the commit reaches, sorted by holder. Never empty. */
  | { readonly kind: 'through'; readonly by: readonly Enclosure[] };

/** Who draws one component, over one build's census. */
export type Enclosing = (component: string, subjects: readonly string[]) => Holding;

export function heldBy(build: BuildDetail): Enclosing {
  const census = build.composition;
  if (census === null) return () => ({ kind: 'unrecorded' });

  const places = new Map(census.map((each) => [each.component, each]));
  const graph = build.reach !== null && build.reach.whole === undefined ? build.reach : null;
  const reached = new Set(graph?.components.map((each) => each.component) ?? []);

  return (component, subjects): Holding => {
    const start = places.get(component);
    if (start === undefined) return { kind: 'unlisted' };
    if (start.within.length === 0) return { kind: 'outermost' };

    // An empty subject list is *nobody said where it moved*, and a walk that
    // read it as a filter would exclude every rung and report a component with
    // an obvious parent as enclosed by nothing the commit reaches.
    const where = new Set(subjects);
    const shares = (name: string): boolean => {
      const place = places.get(name);
      if (place === undefined) return false;
      return where.size === 0 || place.subjects.some((subject) => where.has(subject));
    };

    // Breadth-first, and `seen` is written as a rung is *built* rather than as
    // it is walked: a component enclosed by two things on the same rung would
    // otherwise be queued twice and reported twice under one name.
    const seen = new Set([component]);
    const step = (from: Enclosure | null, within: readonly string[]): Enclosure[] => {
      const rung: Enclosure[] = [];
      for (const holder of within) {
        if (seen.has(holder) || !shares(holder)) continue;
        seen.add(holder);
        rung.push({ holder, through: from === null ? [] : [from.holder, ...from.through] });
      }
      return rung;
    };

    let rung = step(null, start.within);
    while (rung.length > 0) {
      const arrived = rung.filter((each) => reached.has(each.holder));
      if (arrived.length > 0) {
        return {
          kind: 'through',
          by: [...arrived].sort((left, right) => left.holder.localeCompare(right.holder)),
        };
      }
      rung = rung.flatMap((each) => step(each, places.get(each.holder)?.within ?? []));
    }

    return { kind: graph === null ? 'unmeasured' : 'enclosed', within: start.within };
  };
}
