/**
 * The edit, drawn as far as it got.
 *
 * Every other panel starts from a difference and works backwards. This one starts
 * from the commit and works forwards: the files somebody changed, the components
 * the import graph carries them to, and what happened on the renders those
 * components appear in. Three records that already exist, joined on the one axis
 * none of them carries alone — the diff knows nothing about renders, the graph
 * knows nothing about pixels, and the comparison knows nothing about what was
 * edited.
 *
 * ## Five things a file can turn out to have done
 *
 * Only the first is the one everybody builds for.
 *
 * - **the cause in N renders** — a component reached from here is named as the
 *   cause of a difference. The ordinary case.
 * - **present, never the cause** — it renders on screens that moved, and no region
 *   in any of them names it. The screens changed for somebody else's reasons.
 * - **nothing it reaches moved** — every render carrying it held still. An author
 *   who believed they were changing this surface finds out here, and nowhere else
 *   in this category: a comparison tool is silent about a green subject, and
 *   silence is what *worked* looks like too.
 * - **nothing renders what it reaches** — the components exist, the graph arrives
 *   at them, and no subject in the suite draws one. That is a coverage hole
 *   reported against the edit that just walked into it, rather than against a
 *   percentage nobody reads.
 * - **reaches no component** — a server file, a config, a test. Named rather than
 *   hidden, because a file the graph drops is the other reason a change can be
 *   invisible, and it must not look like the case above it.
 *
 * ## What is not claimed
 *
 * A render moving is not evidence that a file on it moved it. `present, never the
 * cause` is exactly that refusal wearing a label: the edge from file to render is
 * the import graph's, and only the region's own `cause` promotes it to an
 * attribution. Splitting collateral between the files that could have caused it is
 * the one number nothing here measured, and the map counts rather than divides for
 * the same reason the docket does.
 */

import type { ReactElement } from 'react';
import type { BuildDetail, ReachView, SubjectView } from '../review-types.js';
import { count, number } from './text.js';

/** What became of one render that draws a reached component. */
export type Landing = 'caused' | 'moved' | 'still' | 'uncompared';

/** One component the commit arrives at, and every render that draws it. */
export interface Arrival {
  readonly component: string;
  /** Seed first, component last. Its middle is the chain worth printing. */
  readonly trail: readonly string[];
  /** Set when the chain opens at a file the scan could not read, not at an edit. */
  readonly throughUnread?: string;
  readonly renders: readonly { readonly subject: SubjectView; readonly landing: Landing }[];
}

/** What a changed file turned out to have done, strongest reading first. */
export type Effect = 'caused' | 'present' | 'still' | 'uncaptured' | 'unreaching';

export interface Edit {
  readonly file: string;
  readonly arrivals: readonly Arrival[];
  readonly effect: Effect;
  /** Renders this file's components are the named cause of. Distinct subjects. */
  readonly caused: number;
}

export interface OutcomeMap {
  readonly edits: readonly Edit[];
  /**
   * Reached components no changed file claims.
   *
   * Their own row, never folded into an edit. A component reached only through a
   * file the scan could not read was reached by the blind spot rather than by the
   * commit, and hanging it under a file somebody actually edited would read as an
   * attribution the traversal declined to make.
   */
  readonly aside: readonly Arrival[];
  /** Changed subjects the commit reaches none of. Counted here, listed below. */
  readonly unreached: number;
}

/**
 * The map, or `null` when there is no honest one to draw.
 *
 * A run that carried no diff has no left column, and a diff the store could not
 * attribute has a left column that would be a lie — `whole` is the refusal, and
 * drawing files with no edges under them would say the commit reaches nothing.
 * The reach panel prints that refusal in words; this returns nothing rather than
 * printing a second, worse version of it.
 */
export function outcomeOf(build: BuildDetail): OutcomeMap | null {
  const reach = build.reach;
  if (reach === null || reach.whole !== undefined || reach.subjects === undefined) return null;

  const drawn = rendersOf(build.subjects, reach);
  const claimed = new Set<string>();
  const edits = reach.changed.map((file) => {
    const arrivals = reach.components
      .filter((component) => component.throughUnread === undefined && component.trail[0] === file)
      .map((component): Arrival => ({
        component: component.component,
        trail: component.trail,
        renders: drawn.get(component.component) ?? [],
      }));
    for (const arrival of arrivals) claimed.add(arrival.component);
    return { file, arrivals, ...verdictOf(arrivals) };
  });

  const aside = reach.components
    .filter((component) => !claimed.has(component.component))
    .map((component): Arrival => ({
      component: component.component,
      trail: component.trail,
      ...(component.throughUnread === undefined ? {} : { throughUnread: component.throughUnread }),
      renders: drawn.get(component.component) ?? [],
    }));

  const unreached = build.subjects.filter(
    (subject) => subject.verdict === 'changed' && reach.subjects?.[subject.subject]?.reached === false,
  ).length;

  return { edits, aside, unreached };
}

/** Every render that draws each component, in the order the report listed them. */
function rendersOf(
  subjects: readonly SubjectView[],
  reach: ReachView,
): Map<string, { readonly subject: SubjectView; readonly landing: Landing }[]> {
  const drawn = new Map<string, { readonly subject: SubjectView; readonly landing: Landing }[]>();
  for (const subject of subjects) {
    const entry = reach.subjects?.[subject.subject];
    if (entry === undefined) continue;
    for (const component of entry.through) {
      const list = drawn.get(component) ?? [];
      list.push({ subject, landing: landingOf(subject, component) });
      drawn.set(component, list);
    }
  }
  return drawn;
}

/**
 * What one render says about one component on it.
 *
 * `caused` is the region's own claim and nothing weaker stands in for it. A
 * subject that changed while carrying this component is `moved` — the component
 * was there, something moved, and which of the two facts explains the other is
 * not recorded. Verdicts that describe no comparison stay off the axis entirely:
 * a new subject never had a baseline to hold still against.
 */
function landingOf(subject: SubjectView, component: string): Landing {
  if (subject.verdict === 'unchanged') return 'still';
  if (subject.verdict !== 'changed') return 'uncompared';
  return subject.regions.some((region) => region.cause === true && region.component === component)
    ? 'caused'
    : 'moved';
}

/**
 * The strongest true reading of a file, and the count behind it.
 *
 * Strongest rather than most common: a file that caused one difference and
 * reaches four quiet components has caused a difference, and a summary ranked by
 * how many of its arrivals were quiet would file the edit under *nothing moved*.
 */
function verdictOf(arrivals: readonly Arrival[]): { readonly effect: Effect; readonly caused: number } {
  const renders = arrivals.flatMap((arrival) => arrival.renders);
  const caused = new Set(
    renders.filter((each) => each.landing === 'caused').map((each) => each.subject.subject),
  ).size;

  if (arrivals.length === 0) return { effect: 'unreaching', caused: 0 };
  if (caused > 0) return { effect: 'caused', caused };
  if (renders.length === 0) return { effect: 'uncaptured', caused: 0 };
  if (renders.some((each) => each.landing === 'moved')) return { effect: 'present', caused: 0 };
  return { effect: 'still', caused: 0 };
}

/** The sentence each effect is worth, and the tone it is worth saying it in. */
const EFFECTS: Readonly<Record<Effect, { readonly tone: string; readonly say: (edit: Edit) => string }>> = {
  caused: { tone: 'va-effect-cause', say: (edit) => `the cause in ${count(edit.caused, 'render')}` },
  present: { tone: 'va-effect-quiet', say: () => 'present, never the cause' },
  still: { tone: 'va-effect-ask', say: () => 'nothing it reaches moved' },
  uncaptured: { tone: 'va-effect-ask', say: () => 'nothing renders what it reaches' },
  unreaching: { tone: 'va-effect-quiet', say: () => 'reaches no component' },
};

export function OutcomeMapView({ build }: { readonly build: BuildDetail }): ReactElement | null {
  const map = outcomeOf(build);
  if (map === null) return null;

  return (
    <div className="va-map">
      <ol className="va-edits">
        {map.edits.map((edit) => (
          <EditRow key={edit.file} edit={edit} />
        ))}
      </ol>

      {map.aside.length === 0 ? null : (
        <div className="va-map-aside">
          <p className="va-map-note">
            {count(map.aside.length, 'component')} reached by a chain that does not open at a
            changed file. The traversal seeds every file it could not read, so these were reached by
            the scan&rsquo;s blind spot rather than by the commit.
          </p>
          <ul className="va-arrivals">
            {map.aside.map((arrival) => (
              <ArrivalRow key={arrival.component} arrival={arrival} />
            ))}
          </ul>
        </div>
      )}

      {map.unreached === 0 ? null : (
        <p className="va-map-note va-map-alarm">
          {count(map.unreached, 'render')} moved with no edge on this map — nothing in the commit
          arrives there. They are counted below, with their record.
        </p>
      )}
    </div>
  );
}

function EditRow({ edit }: { readonly edit: Edit }): ReactElement {
  const effect = EFFECTS[edit.effect];

  return (
    <li className="va-edit">
      <p className="va-edit-head">
        <code className="va-edit-file">{edit.file}</code>
        <span className={`va-effect ${effect.tone}`}>{effect.say(edit)}</span>
      </p>
      {edit.arrivals.length === 0 ? null : (
        <ul className="va-arrivals">
          {edit.arrivals.map((arrival) => (
            <ArrivalRow key={arrival.component} arrival={arrival} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One component, its chain, and a bar of what became of the renders drawing it.
 *
 * The bar is the reason this is a map rather than a table: eleven renders under
 * one component is a number, and ten orange with one green beside it is the shape
 * of an edit that missed one variant. The counts are printed beside it, because a
 * bar alone is a picture of a proportion nobody can quote.
 */
function ArrivalRow({ arrival }: { readonly arrival: Arrival }): ReactElement {
  const tally = {
    caused: arrival.renders.filter((each) => each.landing === 'caused').length,
    moved: arrival.renders.filter((each) => each.landing === 'moved').length,
    still: arrival.renders.filter((each) => each.landing === 'still').length,
    uncompared: arrival.renders.filter((each) => each.landing === 'uncompared').length,
  };
  const through = arrival.trail.slice(1, -1);

  return (
    <li className="va-arrival">
      <span className="va-arrival-name">{arrival.component}</span>
      {through.length === 0 ? null : (
        <span className="va-arrival-through" title={arrival.trail.join(' → ')}>
          through {through.length === 1 ? through[0] : count(through.length, 'file')}
        </span>
      )}
      {arrival.throughUnread === undefined ? null : (
        <span className="va-arrival-through" title={arrival.throughUnread}>
          from an unread file
        </span>
      )}
      <Bar tally={tally} />
      <span className="va-arrival-tally va-num">{phrase(tally)}</span>
    </li>
  );
}

interface Tally {
  readonly caused: number;
  readonly moved: number;
  readonly still: number;
  readonly uncompared: number;
}

/**
 * The proportion, with no bar drawn for a component nothing renders.
 *
 * An empty track and a track of one colour are different findings and would look
 * identical at this size, so the empty one is not drawn at all — the phrase beside
 * it is the whole answer there.
 */
function Bar({ tally }: { readonly tally: Tally }): ReactElement | null {
  const total = tally.caused + tally.moved + tally.still + tally.uncompared;
  if (total === 0) return null;

  return (
    <span className="va-bar" aria-hidden="true">
      {(['caused', 'moved', 'still', 'uncompared'] as const).map((landing) =>
        tally[landing] === 0 ? null : (
          <span
            key={landing}
            className={`va-bar-part va-bar-${landing}`}
            style={{ flexGrow: tally[landing] }}
          />
        ),
      )}
    </span>
  );
}

/**
 * The counts, said as a reviewer would say them.
 *
 * `still` is printed even when it is the only thing to print, because *four
 * renders, none of them moved* is the finding on this row. A phrase that listed
 * only what moved would render that row blank.
 */
function phrase(tally: Tally): string {
  const total = tally.caused + tally.moved + tally.still + tally.uncompared;
  if (total === 0) return 'no render draws it';

  const parts = [
    tally.caused === 0 ? undefined : `${number(tally.caused)} caused`,
    tally.moved === 0 ? undefined : `${number(tally.moved)} moved`,
    tally.still === 0 ? undefined : `${number(tally.still)} still`,
    tally.uncompared === 0 ? undefined : `${number(tally.uncompared)} not compared`,
  ].filter((part): part is string => part !== undefined);

  return `${count(total, 'render')} · ${parts.join(' · ')}`;
}
