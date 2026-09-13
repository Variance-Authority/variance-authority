import type { Band } from '../compare/band.js';
import { explainParting } from '../compare/explain.js';
import { boundarySnapshot } from '../compare/instance.js';
import { partingOf } from '../compare/parting.js';
import type { Digest } from '../format/hash.js';
import type { SemanticSnapshot } from '../format/snapshot.js';
import { movedBands } from './component-hash.js';
import type { ComponentEntry, Rendering } from './composition.js';

/**
 * The finding with no baseline in it, and the sentence that makes it actionable.
 *
 * Split out of `composition.ts` because it is the only part of the graph that
 * reads *documents*. Everything else there folds digests a run already computed;
 * this lifts two instances out of the pages they were found in and compares them
 * — which is the only way to say `color`, and the difference between a reader
 * knowing which subject to open and knowing what is waiting there.
 */

/**
 * The same component, the same inputs, and more than one rendering. At one commit.
 *
 * Not a regression and not a comparison — there is no baseline anywhere in it.
 * It is a statement that the component's own inputs do not determine its output,
 * which is either a fact about the design (a token, a theme, an ancestor) or the
 * reading not being repeatable. `bands` says which kind of difference it is, in
 * the same vocabulary a sensitivity absorbs, so a divergence entirely inside a
 * band the subject relaxes is one a reader can dismiss without opening it.
 *
 * *Inputs*, not *props*, and the difference is the whole finding: a props digest
 * excludes `children` and the checks in `divergencesOf` are what close the gap.
 * A suite can legitimately produce none of these — `examples/todomvc` produces
 * exactly zero — and that is the correct answer for a suite in which nothing
 * renders two ways from one input, not a section to be filled.
 */
export interface Divergence {
  readonly component: string;
  readonly props?: Digest;
  readonly bands: readonly Band[];
  /** At least two, sorted by how many sites each has, widest first. */
  readonly renderings: readonly Rendering[];

  /**
   * Why each rendering after the first parted from it.
   *
   * The half of this finding that used to be missing. "`Price` rendered two ways
   * from one props digest" states the contradiction and stops there, leaving the
   * reader to open two subjects and diff them by eye — which is the work the
   * component graph was built to remove. These lines name the input: an
   * ancestor's `color`, a context, a hook cell, or nothing readable at all.
   *
   * It is reachable here and nowhere else in the system, because a parting needs
   * both sides read the same way and this is the only comparison where that is
   * true by construction: both renderings come out of one run, off one collector,
   * at one commit. A parting across two revisions has to reconcile two configs
   * and two baselines first.
   *
   * Absent when the run supplied no snapshots to read — unknown, not "nothing to
   * say" (ADR-0002). Shorter than `renderings.length - 1` when some rendering's
   * site could not be lifted.
   */
  readonly partings?: readonly DivergenceParting[];
}

/** One rendering of a divergence, and why it parted from the first. */
export interface DivergenceParting {
  /** Index into {@link Divergence.renderings}, always at least 1. */
  readonly rendering: number;
  /** `explainParting` output, comparing that rendering against the first. */
  readonly lines: readonly string[];
}

/**
 * Every props class that produced more than one rendering *from one input*.
 *
 * Three refusals, and all three are the same refusal: a props digest is not a
 * complete statement of a component's inputs, so most pairs of renderings that
 * share one are not a contradiction. Measured on `examples/todomvc` before the
 * checks below existed, **eleven divergences were reported and all eleven were
 * false** — which is what a finding built on an incomplete key looks like.
 *
 * **Unknown props are not shared props.** Instances whose provenance did not
 * survive are not known to have received the same thing. Grouping them and
 * reporting that they render differently manufactures a finding out of missing
 * data, in a system where absent must never read as equal.
 *
 * **Renderings that co-occur in one subject are not alternatives.** A component
 * whose nodes are interrupted by a nested boundary is walked as two boundaries
 * with one owner frame, so one `TextField` becomes a label-shaped rendering and
 * an input-shaped one under a single props digest. That is one instance in two
 * pieces, and it is indistinguishable from two instances that genuinely disagree
 * — so it is not reported. A contradiction is a component that renders as A
 * *here* and as B *there*, never both at once.
 *
 * **Different children are different inputs.** `propsDigest` excludes `children`
 * deliberately (see `digestableProps` in `@variance-authority/react`: folding the
 * subtree in would make every ancestor's props move on any descendant edit, and
 * §6.2's root/collateral rule could never fire). The consequence is that
 * `<Card><Stack/></Card>` and `<Card><Text/></Card>` share a props digest, and
 * calling their different output a contradiction blames the component for its
 * caller. Two proxies for "the children differed" are available and both are
 * required to be quiet: the child components mounted, and the boundary's own
 * text — which is where a string child lands.
 *
 * What survives is narrow on purpose. A movement wrongly dismissed as
 * `contradicted` is an explanation nobody can act on; the same movement left
 * unexplained lands on the suspect shortlist, where a second reading settles it.
 * The asymmetry is the whole reason these checks are here rather than in prose.
 */
export function divergencesOf(
  components: readonly ComponentEntry[],
  snapshots: ReadonlyMap<string, SemanticSnapshot>,
): readonly Divergence[] {
  const divergences: Divergence[] = [];

  for (const entry of components) {
    for (const group of entry.classes) {
      if (group.props === undefined || group.renderings.length < 2) continue;
      if (!fromOneInput(group.renderings)) continue;

      // Union against the first rather than over every pair. A band moves here
      // when the renderings do not all agree on its digest, and a field that
      // disagrees anywhere disagrees with the first somewhere — so the two are
      // the same set, and the mapping stays in `movedBands` where the sensitivity
      // tier reads it.
      const [first, ...rest] = group.renderings;
      const bands = new Set<Band>();
      for (const other of rest) for (const band of movedBands(first!, other)) bands.add(band);

      const partings = partingsOf(group.renderings, snapshots);

      divergences.push({
        component: entry.component,
        props: group.props,
        bands: [...bands],
        renderings: group.renderings,
        ...(partings === undefined ? {} : { partings }),
      });
    }
  }

  return divergences.sort((a, b) => byCodeUnit(a.component, b.component));
}

/**
 * Read every rendering after the first against the first, for the moved input.
 *
 * `elsewhere`, because that is literally what these two are: one instance here
 * and one instance there, at one commit. It is the difference between this
 * finding saying a component is nondeterministic and saying its context decided
 * something — and only the second is true of a thing that moved because the box
 * around it is a different size.
 *
 * Each site is lifted out of its subject and re-rooted at the component before
 * the comparison — {@link boundarySnapshot}'s reason for existing. Comparing the
 * two *subjects* instead would compare a receipt against a promo card, which is
 * the difference the reader already knows about and not the one being asked.
 *
 * `undefined`, never `[]`, when no snapshot for the first rendering's subject was
 * supplied: a run that was never handed the documents has not found the parting
 * unexplainable, it has not looked.
 */
function partingsOf(
  renderings: readonly Rendering[],
  snapshots: ReadonlyMap<string, SemanticSnapshot>,
): readonly DivergenceParting[] | undefined {
  const first = liftFirstSite(renderings[0], snapshots);
  if (first === undefined) return undefined;

  const found: DivergenceParting[] = [];
  for (const [index, rendering] of renderings.entries()) {
    if (index === 0) continue;
    const other = liftFirstSite(rendering, snapshots);
    if (other === undefined) continue;
    found.push({ rendering: index, lines: explainParting(partingOf(first, other, 'elsewhere')) });
  }
  return found;
}

/**
 * One rendering's first site, as a snapshot rooted at the component.
 *
 * The first site and not a chosen one: `sites` is ordered by subject then
 * document position, so this is the same instance on every machine — which the
 * report being a function of the plan requires.
 */
function liftFirstSite(
  rendering: Rendering | undefined,
  snapshots: ReadonlyMap<string, SemanticSnapshot>,
): SemanticSnapshot | undefined {
  const site = rendering?.sites[0];
  if (site === undefined) return undefined;
  const snapshot = snapshots.get(site.subject);
  if (snapshot === undefined) return undefined;
  return boundarySnapshot(snapshot, site.path);
}

/**
 * Whether a props class' renderings can be said to have had the same inputs.
 *
 * The two checks the props digest cannot make for itself — see `divergencesOf`
 * above for why each exists. Both are conservative in the same direction: they
 * answer *no* whenever the run cannot tell, so what remains is a set of
 * renderings that mounted the same children, said the same words, and still came
 * out different, with no two of them observed in one subject.
 */
function fromOneInput(renderings: readonly Rendering[]): boolean {
  const [first, ...rest] = renderings;
  if (first === undefined) return false;

  if (rest.some((other) => other.text !== first.text)) return false;
  if (rest.some((other) => !sameOrder(other.renders, first.renders))) return false;

  const seen = new Set<string>();
  for (const rendering of renderings) {
    for (const subject of new Set(rendering.sites.map((site) => site.subject))) {
      if (seen.has(subject)) return false;
      seen.add(subject);
    }
  }

  return true;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Code-unit order, never `localeCompare`, for `composition.ts`' reason: this
 * output reaches a report that is committed and read back on another runner.
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
