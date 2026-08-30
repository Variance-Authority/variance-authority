import type { Band } from '../compare/band.js';
import type { Composition, ComponentEntry, Site } from './composition.js';

/**
 * Why a component moved — and what it means when nothing here can say.
 *
 * A run already knows *that* a component's own content differs from its
 * baseline: that is `causesBetween`, and it is where every report starts. What it
 * has never known is whether anybody edited the thing. Those are different
 * questions, and the gap between them is where flakes live:
 *
 * > Detect a pixel change. Find the HTML area behind it. Find no related change.
 * > That is a flake — or the beginning of one.
 *
 * The last step is the one that needs evidence, and the evidence has to be
 * assembled rather than assumed. Four kinds are available to a run that has
 * already done its work, in descending order of how much they explain:
 *
 * 1. **An edit.** A file declaring this component is in the change set. Nothing
 *    further is interesting; somebody changed it and the run noticed.
 * 2. **A token.** A custom property this component's own nodes resolve through
 *    took a new value in this run. The component's code is untouched and its
 *    output legitimately moved.
 * 3. **An ancestor.** A component that reaches it was edited, and it is reached
 *    by climbing — the caller that wrote the element, or, on a build where React
 *    kept no owner, the enclosure graph of the subject it moved in until an
 *    edited name appears. Its props are not recoverable in detail, but *this
 *    moved on what it was given* is the sentence, and it names a real file.
 * 4. **A contradiction.** The same component, with the same props, rendered
 *    somewhere else in this same run and rendered *differently*. That is not an
 *    explanation — it is proof the explanation is not in the component's own
 *    code, because one commit produced two answers from one input.
 *
 * And then **unexplained**, which is the finding. A component whose content
 * moved, whose file nobody touched, whose tokens held, whose ancestors held, and
 * which rendered identically everywhere else in the suite at this commit. That
 * last clause is the part no previous version of this could say, and it is what
 * the cross-subject join bought: the *stable states to refer to* are the other
 * sites of the same rendering, and the run already has them.
 *
 * ## What this refuses to conclude
 *
 * Unexplained is not a flake. This system's position on what establishes a flake
 * has not moved: a subject is unstable when it fails to read the same way twice,
 * and one reading can never prove instability
 * ([`flakiness.md`](../../../../docs/flakiness.md)). What an unexplained movement
 * is, exactly, is **the shortlist of subjects worth reading twice** — which is
 * the scarce resource a sweep spends, and until now it was spent on `changed`
 * subjects in whatever order the plan produced them.
 */

export type Cause = 'edited' | 'token' | 'upstream' | 'contradicted' | 'unexplained';

/** One component the run found to have moved in one subject. */
export interface Moved {
  readonly subject: string;
  readonly component: string;
  /**
   * Which bands moved, when the run could tell.
   *
   * Empty when the comparison produced names only — a baseline written before
   * the bands were split carries no per-band digests, and an empty list here
   * means *not known*, never *no band*.
   */
  readonly bands: readonly Band[];
}

/** What a run can put beside a movement to explain it. */
export interface Evidence {
  /**
   * Files in the change set, from whichever flag read a diff. Absent when none did.
   *
   * Absent and empty are different answers and are kept different: a run with no
   * `--since` has not established that nobody edited anything, and reading its
   * silence as "no edits" would attribute every movement in the suite to nothing
   * and call the result a flake list.
   */
  readonly changed?: readonly string[];

  /** Component name → the files that declare it, from the source index. */
  readonly declaredIn?: ReadonlyMap<string, readonly string[]>;

  /** Tokens whose resolved value moved in this run. Absent when nothing asked. */
  readonly tokens?: readonly string[];

  /** Subjects that failed to read the same way twice in this run. */
  readonly unstable?: ReadonlySet<string>;
}

export interface Movement {
  readonly subject: string;
  readonly component: string;
  readonly bands: readonly Band[];
  readonly cause: Cause;
  /** One sentence, naming the evidence rather than the category. */
  readonly because: string;

  readonly file?: string;
  readonly tokens?: readonly string[];
  readonly upstream?: string;

  /**
   * Components between `upstream` and this one, outermost first.
   *
   * Empty when the edited component draws it directly, and present only on the
   * `upstream` rung. A reviewer sent to `ProductCard` for a `CardFooter` that
   * moved has one question — *how does that reach this* — and the answer is two
   * names the run already holds.
   */
  readonly through?: readonly string[];

  /**
   * Other subjects in which this same component moved in this run.
   *
   * The "one cause, N subjects" fold. A reviewer reading eleven changed subjects
   * is often reading one edit, and the count is the difference between a
   * frightening report and an accurate one.
   */
  readonly alsoIn: readonly string[];

  /**
   * Sites of this component, with the same props, that this run did not report
   * moving.
   *
   * The control group, and the reason an unexplained movement is worth
   * reporting rather than shrugging at. Empty means there was no control — the
   * component appears nowhere else with these inputs — which weakens the finding
   * and is why it is a list rather than a flag.
   */
  readonly held: readonly Site[];
}

export interface Attribution {
  /** Every movement supplied, in the order supplied, each with a cause. */
  readonly movements: readonly Movement[];

  /**
   * Unexplained movements in subjects that also failed to read the same way
   * twice. A movement nothing explains, in a subject already proven unstable.
   */
  readonly flakes: readonly Movement[];

  /**
   * Unexplained movements in subjects nothing has read twice.
   *
   * Not a verdict. The shortlist a sweep should spend its second readings on,
   * ordered by how much control the suite has over each — a component that
   * rendered identically in six other places and moved here is a better use of a
   * second reading than one that appears nowhere else.
   */
  readonly suspects: readonly Movement[];
}

/**
 * Attribute every movement, given whatever evidence the run assembled.
 *
 * Degrades honestly. With no change set the `edited` rung is unreachable and
 * every movement falls to a lower one, so a run that did not ask cannot produce
 * a confident `unexplained` — which is checked here rather than trusted to the
 * caller, because the shortlist this feeds is exactly the thing somebody will
 * act on.
 */
export function attributeMovement(
  moved: readonly Moved[],
  composition: Composition,
  evidence: Evidence = {},
): Attribution {
  const byComponent = new Map(composition.components.map((entry) => [entry.component, entry]));
  const movedIn = new Map<string, string[]>();
  for (const each of moved) {
    const subjects = movedIn.get(each.component) ?? [];
    subjects.push(each.subject);
    movedIn.set(each.component, subjects);
  }

  const edited = new Set(
    [...(evidence.declaredIn ?? new Map<string, readonly string[]>())]
      .filter(([, files]) => files.some((file) => (evidence.changed ?? []).includes(file)))
      .map(([component]) => component),
  );

  const graph = graphOf(composition);

  const movements = moved.map((each) =>
    attributeOne(each, byComponent.get(each.component), {
      movedIn,
      edited,
      evidence,
      composition,
      graph,
    }),
  );

  const unexplained = movements.filter((movement) => movement.cause === 'unexplained');

  return {
    movements,
    flakes: unexplained.filter((movement) => evidence.unstable?.has(movement.subject) === true),
    suspects: unexplained
      .filter((movement) => evidence.unstable?.has(movement.subject) !== true)
      .sort((a, b) => b.held.length - a.held.length),
  };
}

/** Everything the run assembled, gathered so one movement can be asked about. */
interface Bench {
  readonly movedIn: ReadonlyMap<string, readonly string[]>;
  readonly edited: ReadonlySet<string>;
  readonly evidence: Evidence;
  readonly composition: Composition;
  readonly graph: Graph;
}

function attributeOne(moved: Moved, entry: ComponentEntry | undefined, bench: Bench): Movement {
  const { movedIn, edited, evidence, composition, graph } = bench;
  const alsoIn = (movedIn.get(moved.component) ?? []).filter(
    (subject) => subject !== moved.subject,
  );
  const held = heldSites(moved, entry, movedIn);
  const base = { ...moved, alsoIn, held };

  const file = (evidence.declaredIn?.get(moved.component) ?? []).find((each) =>
    (evidence.changed ?? []).includes(each),
  );
  if (file !== undefined) {
    return { ...base, cause: 'edited', file, because: `\`${file}\` is in the change set` };
  }

  const tokens = movedTokens(moved.component, composition, evidence);
  if (tokens.length > 0) {
    return {
      ...base,
      cause: 'token',
      tokens,
      because: `it resolves through ${tokens.map((token) => `\`${token}\``).join(', ')}, which moved in this run`,
    };
  }

  const ancestor = editedAncestor(moved, edited, graph);
  if (ancestor !== undefined) {
    return {
      ...base,
      cause: 'upstream',
      upstream: ancestor.name,
      ...(ancestor.through.length === 0 ? {} : { through: ancestor.through }),
      because: becauseUpstream(ancestor),
    };
  }

  const contradiction = composition.divergences.find(
    (divergence) =>
      divergence.component === moved.component &&
      divergence.renderings.some((rendering) =>
        rendering.sites.some((site) => site.subject === moved.subject),
      ),
  );
  if (contradiction !== undefined) {
    return {
      ...base,
      cause: 'contradicted',
      because:
        `at this commit it renders ${contradiction.renderings.length} different ways from the same props ` +
        `(${contradiction.bands.join(', ')}), so the change is not in its own code`,
    };
  }

  return { ...base, cause: 'unexplained', because: unexplainedBecause(base, evidence) };
}

/**
 * Who encloses what and who wrote what, in each subject separately.
 *
 * Keyed on the pair because the constraint is the whole point. `ComponentEntry.within`
 * and `ComponentEntry.createdBy` are both folded over the suite, so `Card` is enclosed by
 * `CartCard` and by `ProductCard` at once, and a walk that reads either hands a
 * reviewer the cart as the reason a product story moved. A site knows which
 * subject it was read in, so the graph can be built the way the question is
 * asked — and it has to be built that way for *both* edges, because the creator
 * is consulted first and an unconstrained answer there is never reached by the
 * constrained walk underneath it.
 */
type Enclosures = ReadonlyMap<string, readonly string[]>;

interface Graph {
  /** Who this component sits inside, per subject. */
  readonly within: Enclosures;
  /** Whose JSX wrote this component's element, per subject. */
  readonly wrote: Enclosures;
}

const IN = '\u0000';

function graphOf(composition: Composition): Graph {
  const within = new Map<string, string[]>();
  const wrote = new Map<string, string[]>();

  const add = (graph: Map<string, string[]>, key: string, name: string): void => {
    const names = graph.get(key);
    if (names === undefined) graph.set(key, [name]);
    else if (!names.includes(name)) names.push(name);
  };

  for (const entry of composition.components) {
    for (const group of entry.classes) {
      for (const rendering of group.renderings) {
        for (const site of rendering.sites) {
          const key = `${site.subject}${IN}${entry.component}`;
          if (site.within !== undefined) add(within, key, site.within);
          if (site.createdBy !== undefined) add(wrote, key, site.createdBy);
        }
      }
    }
  }

  for (const names of within.values()) names.sort();
  for (const names of wrote.values()) names.sort();
  return { within, wrote };
}

/** An edited component above a moved one, and the components in between. */
interface Ancestor {
  readonly name: string;
  /** Outermost first, and empty when the edited component draws it directly. */
  readonly through: readonly string[];
}

/**
 * The nearest edited component above this one, in the subject it moved in.
 *
 * The creator first, and it is not a tie-break. The component that *wrote the
 * element* is the one whose edit changed this component's inputs; the one it
 * happens to sit inside may be a presentational wrapper that knows nothing about
 * it. On `examples/todomvc` every `Chip` sits within a `Stack` and is created by
 * `TodoFooter`, so a run consulting only enclosure would fail to connect an edit
 * to `TodoFooter` with the chips it moved — and report five unexplained movements
 * instead of one caller. It is absent on a production build, which is why the
 * enclosure walk is not a fallback but the other half.
 *
 * Read off the per-subject graph and not off the entry. The entry's `createdBy`
 * is the suite's whole set, so an edit to whoever writes this component on one
 * page answers for every page it appears on — the same unconstrained answer the
 * walk below refuses, arriving one line earlier and winning.
 *
 * And that walk climbs rather than looking once. The rung has always said
 * *ancestor* and checked a parent, and a React tree is mostly components that
 * draw one wrapper each: `ProductCard` was edited, `ProductCard` draws `Card`,
 * `Card` draws `CardFooter`, and one look up arrives at `Card`, whose file nobody
 * touched. That is the shape of every unexplained movement this ladder used to
 * produce over an edit it was holding the graph for.
 */
function editedAncestor(
  moved: Moved,
  edited: ReadonlySet<string>,
  graph: Graph,
): Ancestor | undefined {
  const here = `${moved.subject}${IN}${moved.component}`;
  const wrote = (graph.wrote.get(here) ?? []).find((name) => edited.has(name));
  if (wrote !== undefined) return { name: wrote, through: [] };

  // Breadth-first, so the answer is the *nearest* edit and not whichever one the
  // recursion reached first. `seen` is written as a rung is built: an enclosure
  // graph folded over a suite can close a loop, and a component reached twice on
  // one rung would otherwise queue twice.
  const seen = new Set([moved.component]);
  const step = (from: Ancestor | null): Ancestor[] => {
    const child = from === null ? moved.component : from.name;
    const rung: Ancestor[] = [];
    for (const holder of graph.within.get(`${moved.subject}${IN}${child}`) ?? []) {
      if (seen.has(holder)) continue;
      seen.add(holder);
      rung.push({ name: holder, through: from === null ? [] : [from.name, ...from.through] });
    }
    return rung;
  };

  let rung = step(null);
  while (rung.length > 0) {
    const arrived = rung.find((each) => edited.has(each.name));
    if (arrived !== undefined) return arrived;
    rung = rung.flatMap(step);
  }

  return undefined;
}

/**
 * The upstream sentence, which is the one a reviewer acts on.
 *
 * It says three things and the third is the reason the first two are worth
 * printing: an edited component reaches this one, this one's own file is not in
 * the change set, and therefore what moved here is what it was handed. Every
 * rung above this has already been tried, so *its own code* and *a token it
 * reads* are both ruled out by the time this speaks.
 */
function becauseUpstream(ancestor: Ancestor): string {
  const reaches =
    ancestor.through.length === 0 ? 'mounts it' : `reaches it through ${chain(ancestor.through)}`;

  return (
    `\`${ancestor.name}\` was edited and ${reaches}; nothing edited its own file, ` +
    `so it moved on what it was given`
  );
}

/** The components in between, named while there are few enough to be worth naming. */
function chain(through: readonly string[]): string {
  const named = through.map((name) => `\`${name}\``);
  if (named.length === 1) return named[0] ?? '';
  if (named.length > 3) return `${named.slice(0, 3).join(', ')} and ${String(named.length - 3)} more`;
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] ?? ''}`;
}

function unexplainedBecause(
  movement: { readonly component: string; readonly held: readonly Site[] },
  evidence: Evidence,
): string {
  if (evidence.changed === undefined) {
    return 'nothing was asked about what changed, so nothing here explains it — run with `--against` to reach the first rung';
  }

  if (movement.held.length === 0) {
    return 'no file, token or ancestor explains it, and it renders nowhere else in this run to compare against';
  }

  return (
    `no file, token or ancestor explains it, and the same component with the same props held in ` +
    `${movement.held.length} other place(s) in this run`
  );
}

/**
 * Sites of the same component that this run did not report moving.
 *
 * Restricted to props classes this subject actually participates in, because a
 * component rendered with different inputs elsewhere is not a control for this
 * one — it is a different question that happens to share a name.
 */
function heldSites(
  moved: Moved,
  entry: ComponentEntry | undefined,
  movedIn: ReadonlyMap<string, readonly string[]>,
): readonly Site[] {
  if (entry === undefined) return [];

  const alsoMoved = new Set(movedIn.get(moved.component) ?? []);

  return entry.classes
    .filter((group) =>
      group.renderings.some((rendering) =>
        rendering.sites.some((site) => site.subject === moved.subject),
      ),
    )
    .flatMap((group) => group.renderings)
    .flatMap((rendering) => rendering.sites)
    .filter((site) => !alsoMoved.has(site.subject));
}

/**
 * Tokens this component resolves through that moved in this run.
 *
 * Read off the instances rather than off the subject, which is the distinction
 * that makes the answer worth anything: every subject on a themed page resolves
 * through every token in the theme, so a subject-level intersection names them
 * all and explains nothing.
 */
function movedTokens(
  component: string,
  composition: Composition,
  evidence: Evidence,
): readonly string[] {
  if (evidence.tokens === undefined || evidence.tokens.length === 0) return [];

  const entry = composition.components.find((each) => each.component === component);
  if (entry === undefined) return [];

  const moved = new Set(evidence.tokens);
  return [...entry.tokens].filter((token) => moved.has(token)).sort();
}
