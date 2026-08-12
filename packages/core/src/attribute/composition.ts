import type { Band } from '../compare/band.js';
import type { Digest } from '../format/hash.js';
import type { NodePath } from '../format/snapshot.js';
import { movedBands } from './component-hash.js';
import { attributed, type ComponentInstance } from './instances.js';

/**
 * The suite read as one graph, at one commit.
 *
 * Every other comparison in this system is between two revisions of one subject.
 * This is the other axis: **many subjects, one revision**, joined on the
 * components they share. It answers the question a per-subject tool cannot even
 * phrase — *this component, here, is the same component you already have an
 * example of over there* — and it answers it from digests a run already
 * computed, with no second render, no image and no store.
 *
 * ## What the join is worth
 *
 * A suite of examples is a suite of *compositions*. The narrow example is a
 * component at a boundary; the page examples contain that same boundary again,
 * sometimes with the same props and sometimes not. Once the instances are
 * addressable, three facts fall out that nobody had:
 *
 * - **An echo.** One rendering, several subjects. The narrow example and the
 *   page are watching literally the same bytes, so a change in one is a change
 *   in all of them, and a reviewer looking at eleven diffs is looking at one.
 * - **A divergence.** Same component, same props, *different* rendering, at one
 *   commit. Nothing about the component's own inputs can explain that. Either
 *   something outside it decides its output — an ancestor's cascade, a token, its
 *   own state — or the reading is not repeatable. Both are findings and neither
 *   is a regression.
 * - **A control group.** For any instance that moved, the same rendering
 *   somewhere else that did *not* is a stable state to refer to. That is the
 *   referent flake attribution has always needed and never had, and the suite
 *   supplies it for free: one commit already holds N renderings of every shared
 *   component.
 *
 * ## What it deliberately does not do
 *
 * It never decides anything. Two subjects sharing a rendering is not a reason to
 * delete either — that is the argument `coverage.ts` makes at the level of names
 * and it holds harder here, because a component can be correct in one context
 * and broken in the next, which is why the contexts are separate subjects.
 */

/** One instance, located. */
export interface Site {
  readonly subject: string;
  readonly path: NodePath;
  readonly depth: number;
  readonly within?: string;
}

/** One rendering of one component, and everywhere it occurred. */
export interface Rendering {
  readonly rendering: Digest;
  readonly structure: Digest;
  readonly semantics: Digest;
  readonly text: Digest;
  readonly style: Digest;

  /**
   * Child components this rendering mounted, in document order.
   *
   * Carried on the rendering rather than only on the entry because it is the
   * only evidence available about what was passed *in*: `propsDigest` excludes
   * `children` by design, so two renderings that mount different children are
   * two different inputs wearing one props digest. `divergencesOf` refuses to
   * call that a contradiction, and this is the field it reads.
   */
  readonly renders: readonly string[];

  /** In subject order, then document order. */
  readonly sites: readonly Site[];
}

/** One props digest of one component, and every way it rendered under it. */
export interface PropsClass {
  /** Absent when the collector supplied no provenance — unknown, not "none". */
  readonly props?: Digest;
  readonly renderings: readonly Rendering[];
}

export interface ComponentEntry {
  readonly component: string;
  /** Subjects containing at least one boundary of it, in the order supplied. */
  readonly subjects: readonly string[];
  /** Boundaries summed across every subject. Distinct from `subjects.length`. */
  readonly instances: number;

  /**
   * Subjects whose shallowest attributed boundary is this component.
   *
   * The narrow example — the subject that exists to show this thing, rather than
   * a page that happens to contain it. Defined by depth rather than by a naming
   * convention because a naming convention is a different tool's `story:` prefix,
   * and this has to hold for a route suite too. Ties resolve to nothing: a
   * subject whose two shallowest boundaries are siblings has no single subject.
   */
  readonly examples: readonly string[];

  /** Components that enclose it somewhere, sorted. The graph, upwards. */
  readonly within: readonly string[];

  /**
   * Components that *mounted* it somewhere, sorted. The graph, upwards, again —
   * and usually the more useful of the two.
   *
   * `within` is where the boundary sits in the DOM and this is who wrote the
   * element. They are the same thing only for a component that authors a node of
   * its own, and a real application is full of components that do not: measured
   * on `examples/todomvc`, every `Chip` reports `within: ['Stack']` and
   * `createdBy: ['TodoFooter']`. `TodoFooter` renders nothing but other
   * components, so it owns no node, is a boundary nowhere, and appears in this
   * graph *only* here — while being the file a reviewer has to open.
   *
   * Empty on a production build, where `_debugOwner` is absent (ADR-0007). Empty
   * is *not* "nothing mounted it": a component with no caller is the subject root
   * and every other case is missing data, which is why the `upstream` rung in
   * `movement.ts` reads this and never concludes from its silence.
   */
  readonly createdBy: readonly string[];

  /** Components it encloses somewhere, sorted. The graph, downwards. */
  readonly renders: readonly string[];

  /**
   * Custom properties its own nodes resolve through, anywhere in the suite.
   *
   * The set a token movement is intersected against, which is how "`--va-space-3`
   * moved" becomes "`--va-space-3` moved and these four components read it".
   */
  readonly tokens: readonly string[];

  /** Sorted by props digest; the class with unknown props sorts last. */
  readonly classes: readonly PropsClass[];
}

/**
 * The same component, the same props, the same bytes, in more than one subject.
 *
 * The connected dots. `example` names the narrow subject among the sites when
 * there is one, because that is the artefact a reviewer already has an opinion
 * about — "this is the Chip from the Chip story" is a sentence, and "these four
 * paths share a digest" is not.
 */
export interface Echo {
  readonly component: string;
  readonly props?: Digest;
  readonly rendering: Digest;
  /** At least two, spanning at least two subjects. */
  readonly sites: readonly Site[];
  readonly example?: string;
}

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
}

export interface SubjectComposition {
  readonly subject: string;
  readonly instances: readonly ComponentInstance[];
}

export interface Composition {
  /** In the order supplied, which the run guarantees is plan order. */
  readonly subjects: readonly string[];
  /** Sorted by name, code-unit order. */
  readonly components: readonly ComponentEntry[];
  /** Sorted by how many sites each has, widest first, then by component. */
  readonly echoes: readonly Echo[];
  /** Sorted by component name. */
  readonly divergences: readonly Divergence[];
}

/**
 * Fold a run's per-subject instance lists into the graph.
 *
 * Pure, ordered, and a function of its input alone — the run's report has to be
 * a function of the plan, and a phase that accumulated as a worker pool finished
 * would produce a different artefact from the same suite on a slower machine.
 */
export function composeSubjects(subjects: readonly SubjectComposition[]): Composition {
  const entries = new Map<string, Accumulator>();
  const order = subjects.map((subject) => subject.subject);

  for (const subject of subjects) {
    const example = exampleOf(subject.instances);

    for (const instance of subject.instances) {
      if (!attributed(instance)) continue;

      const entry = accumulate(entries, instance.component);
      if (entry.subjects.at(-1) !== subject.subject) entry.subjects.push(subject.subject);
      entry.instances += 1;
      if (example === instance.component && entry.examples.at(-1) !== subject.subject) {
        entry.examples.push(subject.subject);
      }
      if (instance.within !== undefined) entry.within.add(instance.within);
      if (instance.createdBy !== undefined) entry.createdBy.add(instance.createdBy);
      for (const child of instance.renders) entry.renders.add(child);
      for (const token of instance.tokens) entry.tokens.add(token);

      const key = instance.props ?? UNKNOWN_PROPS;
      const byProps = entry.classes.get(key) ?? new Map<Digest, MutableRendering>();
      const rendering = byProps.get(instance.rendering) ?? {
        rendering: instance.rendering,
        structure: instance.structure,
        semantics: instance.semantics,
        text: instance.text,
        style: instance.style,
        renders: instance.renders,
        sites: [],
      };
      rendering.sites.push({
        subject: subject.subject,
        path: instance.path,
        depth: instance.depth,
        ...(instance.within === undefined ? {} : { within: instance.within }),
      });
      byProps.set(instance.rendering, rendering);
      entry.classes.set(key, byProps);
    }
  }

  const components = [...entries.entries()]
    .map(([component, entry]) => ({
      component,
      subjects: entry.subjects,
      instances: entry.instances,
      examples: entry.examples,
      within: [...entry.within].sort(byCodeUnit),
      createdBy: [...entry.createdBy].sort(byCodeUnit),
      renders: [...entry.renders].sort(byCodeUnit),
      tokens: [...entry.tokens].sort(byCodeUnit),
      classes: [...entry.classes.entries()]
        .sort(([a], [b]) => byCodeUnit(a, b))
        .map(([props, renderings]) => ({
          ...(props === UNKNOWN_PROPS ? {} : { props }),
          renderings: [...renderings.values()].sort(widestFirst),
        })),
    }))
    .sort((a, b) => byCodeUnit(a.component, b.component));

  return {
    subjects: order,
    components,
    echoes: echoesOf(components),
    divergences: divergencesOf(components),
  };
}

/**
 * Every rendering shared by two or more subjects.
 *
 * Two instances of one component inside a *single* subject sharing a rendering
 * is ordinary and says nothing — a list of three identical chips is three
 * identical chips. The finding is a rendering that survives being mounted
 * somewhere else, because that is the one a second subject is watching.
 */
function echoesOf(components: readonly ComponentEntry[]): readonly Echo[] {
  const echoes: Echo[] = [];

  for (const entry of components) {
    for (const group of entry.classes) {
      for (const rendering of group.renderings) {
        const spread = new Set(rendering.sites.map((site) => site.subject));
        if (spread.size < 2) continue;

        const example = entry.examples.find((subject) => spread.has(subject));
        echoes.push({
          component: entry.component,
          ...(group.props === undefined ? {} : { props: group.props }),
          rendering: rendering.rendering,
          sites: rendering.sites,
          ...(example === undefined ? {} : { example }),
        });
      }
    }
  }

  return echoes.sort(
    (a, b) => b.sites.length - a.sites.length || byCodeUnit(a.component, b.component),
  );
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
function divergencesOf(components: readonly ComponentEntry[]): readonly Divergence[] {
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

      divergences.push({
        component: entry.component,
        props: group.props,
        bands: [...bands],
        renderings: group.renderings,
      });
    }
  }

  return divergences.sort((a, b) => byCodeUnit(a.component, b.component));
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
 * The component a subject exists to show, when one component does.
 *
 * The shallowest attributed boundary, and only when it is alone at that depth.
 * A story usually mounts one thing; a page mounts a layout that mounts several,
 * and calling the first of them the subject's component would be picking a
 * winner out of document order.
 */
function exampleOf(instances: readonly ComponentInstance[]): string | undefined {
  const shallowest = instances.filter(attributed).reduce<number>((depth, instance) => {
    return Math.min(depth, instance.depth);
  }, Number.POSITIVE_INFINITY);

  const leads = instances.filter((instance) => attributed(instance) && instance.depth === shallowest);
  const names = new Set(leads.map((instance) => instance.component));
  return leads.length === 1 || names.size === 1 ? leads[0]?.component : undefined;
}

/**
 * The key an instance with no props digest is filed under.
 *
 * A sentinel rather than `undefined`, because a `Map` keyed on `Digest |
 * undefined` reads as though unknown props were a props class like any other,
 * and every consumer would then have to remember that it is not. It sorts last
 * by construction — no digest starts with a space.
 */
const UNKNOWN_PROPS = ' unknown';

interface Accumulator {
  readonly subjects: string[];
  instances: number;
  readonly examples: string[];
  readonly within: Set<string>;
  readonly createdBy: Set<string>;
  readonly renders: Set<string>;
  readonly tokens: Set<string>;
  readonly classes: Map<string, Map<Digest, MutableRendering>>;
}

/** A `Rendering` while its sites are still being collected. */
interface MutableRendering extends Omit<Rendering, 'sites'> {
  readonly sites: Site[];
}

function accumulate(entries: Map<string, Accumulator>, component: string): Accumulator {
  const existing = entries.get(component);
  if (existing !== undefined) return existing;

  const created: Accumulator = {
    subjects: [],
    instances: 0,
    examples: [],
    within: new Set(),
    createdBy: new Set(),
    renders: new Set(),
    tokens: new Set(),
    classes: new Map(),
  };
  entries.set(component, created);
  return created;
}

function widestFirst(a: Rendering, b: Rendering): number {
  return b.sites.length - a.sites.length || byCodeUnit(a.rendering, b.rendering);
}

/**
 * Code-unit order, never `localeCompare`.
 *
 * The same rule `hashComponents` sorts by, for the same reason: this output
 * reaches a report that is committed, diffed and read back on another runner,
 * and a locale-aware comparison makes the byte order a promise about `LANG`.
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
