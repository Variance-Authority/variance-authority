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
 * 3. **An ancestor.** A component enclosing it was edited. Its props are not
 *    recoverable in detail, but *something upstream changed* is a better sentence
 *    than silence and points at a real file.
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
   * Files in the change set, from `--since`. Absent when nothing asked.
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

  const movements = moved.map((each) =>
    attributeOne(each, byComponent.get(each.component), movedIn, edited, evidence, composition),
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

function attributeOne(
  moved: Moved,
  entry: ComponentEntry | undefined,
  movedIn: ReadonlyMap<string, readonly string[]>,
  edited: ReadonlySet<string>,
  evidence: Evidence,
  composition: Composition,
): Movement {
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

  // `createdBy` first, and it is not a tie-break. The component that *wrote the
  // element* is the one whose edit changed this component's inputs; the one it
  // happens to sit inside may be a presentational wrapper that knows nothing
  // about it. On `examples/todomvc` every `Chip` sits within a `Stack` and is
  // created by `TodoFooter`, so a run consulting only `within` would fail to
  // connect an edit to `TodoFooter` with the chips it moved — and report five
  // unexplained movements instead of one caller.
  const upstream =
    (entry?.createdBy ?? []).find((name) => edited.has(name)) ??
    (entry?.within ?? []).find((name) => edited.has(name));
  if (upstream !== undefined) {
    return {
      ...base,
      cause: 'upstream',
      upstream,
      because: `\`${upstream}\` mounts it and was edited; its own file was not`,
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

function unexplainedBecause(
  movement: { readonly component: string; readonly held: readonly Site[] },
  evidence: Evidence,
): string {
  if (evidence.changed === undefined) {
    return 'nothing was asked about what changed, so nothing here explains it — run with `--since` to reach the first rung';
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
