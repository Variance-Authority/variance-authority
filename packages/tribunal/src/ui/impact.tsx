/**
 * What this build is a build *of*, and how far the edit landed from itself.
 *
 * A docket names components. It never named the commit those components are a
 * consequence of, and a reviewer arriving at a build had the one thing they could
 * not get from the pixels — the diff — sitting in the store, unprinted. Three
 * facts, in the order somebody reads them:
 *
 * - **The commits.** A build is one commit, and a build following another build
 *   is a range. The range is the accumulation: two builds apart, the changes on
 *   this page are the consequence of everything between them, and a single hash
 *   at the top of the screen invites the reader to blame the last one.
 * - **The files.** `reach.changed` is the diff, already read, already stored. It
 *   is the shortest answer to *why did anything move at all*, and until now it
 *   was reachable only from a second page.
 * - **How far it went.** Depth from an edited file to a component that moved.
 *
 * The third is the one worth the space. A commit whose movement is all at depth
 * zero did what it said; a commit with eleven components moving three imports out
 * changed something shared, and that is the difference between an afternoon and a
 * revert. It is measurable here and nowhere else on the surface — every other
 * page is scoped to one change, and depth is a property of the whole spread.
 */

import type { ReactElement } from 'react';
import type { BuildDetail } from '../review-types.js';
import { attributionsOf } from './attribution.js';
import { Marked } from './because.js';
import type { Crossing } from './crossing.js';
import { spreadOf, type Depth, type Unplaced } from './distance.js';
import { heldBy, type Enclosure, type Holding } from './holding.js';
import { count, number } from './text.js';

/** How many paths are printed before the rest become a count. */
const NAMED = 10;

export function Impact({
  build,
  crossing,
}: {
  readonly build: BuildDetail;
  readonly crossing: Crossing;
}): ReactElement {
  const earlier = crossing.state === 'ready' ? crossing.earlier : undefined;
  const since = earlier?.commit === build.commit ? undefined : earlier;

  return (
    <section className="va-impact">
      <p className="va-impact-commit">
        {since === undefined ? null : (
          <>
            <code className="va-commit">{since.commit.slice(0, 8)}</code>
            <span className="va-note"> … </span>
          </>
        )}
        <code className="va-commit">{build.commit.slice(0, 8)}</code>
        {build.branch === undefined ? null : <span className="va-note"> on {build.branch}</span>}
        {since === undefined ? null : (
          <span className="va-note">
            {' '}
            — everything since build {since.build}, not one commit
          </span>
        )}
      </p>

      <Changed build={build} />
      <Spread build={build} />
    </section>
  );
}

/** The diff itself: what the commit touched, and against what. */
function Changed({ build }: { readonly build: BuildDetail }): ReactElement {
  const { reach } = build;

  if (reach === null) {
    return (
      <p className="va-note">
        No diff was read for this build, so nothing here can say which files it came from.
      </p>
    );
  }

  if (reach.whole !== undefined) {
    return (
      <p className="va-note">
        The diff against <code>{reach.against}</code> could not be attributed: {reach.whole}
      </p>
    );
  }

  const named = reach.changed.slice(0, NAMED);
  const rest = reach.changed.length - named.length;

  return (
    <div className="va-impact-files">
      <p className="va-note">
        {count(reach.changed.length, 'file')} changed against <code>{reach.against}</code>
      </p>
      <ul title={reach.changed.join('\n')}>
        {named.map((file) => (
          <li key={file}>
            <code>{file}</code>
          </li>
        ))}
        {rest === 0 ? null : <li className="va-note">and {count(rest, 'more file')}</li>}
      </ul>
    </div>
  );
}

/**
 * The impact-depth histogram, and the one sentence derived from it.
 *
 * The sentence is the deepest rung anything moved on, because that is the number
 * a reviewer would otherwise have to read off the bars themselves — and a chart
 * whose headline the reader has to compute is a chart that gets skipped.
 */
function Spread({ build }: { readonly build: BuildDetail }): ReactElement | null {
  const spread = spreadOf(build);
  if (spread === null || spread.rungs.length === 0) return null;

  const deepest = [...spread.rungs].reverse().find((rung) => rung.moved > 0);
  const widest = Math.max(...spread.rungs.map((rung) => rung.reached));

  return (
    <div className="va-impact-depth">
      <h2>How far the edit landed</h2>
      <p className="va-note">
        {deepest === undefined
          ? 'Nothing the commit declares moved.'
          : deepest.depth === 0
            ? 'Movement in what the commit declares stops at the files it changed.'
            : `Movement reaches ${count(deepest.depth, 'import')} out from an edited file.`}
      </p>
      <ul className="va-rungs">
        {spread.rungs.map((rung) => (
          <Rung key={rung.depth} rung={rung} widest={widest} />
        ))}
      </ul>
      <Undeclared build={build} moved={spread.undeclared} />
    </div>
  );
}

/**
 * The movement the histogram cannot hold, and the reason for each of it.
 *
 * Depth is measured from an edited file, so a component no changed file declares
 * has nothing to be measured from and drops out of every bar above. This said *no
 * rung above holds them* and stopped there, which restates the axis instead of
 * answering the question — and it was answerable twice over, because the run had
 * already climbed the other direction and written a sentence per movement.
 *
 * So the run's own sentence is what this prints. The census walk in
 * [`holding.ts`](./holding.js) is kept underneath it and used only where the
 * store holds no attribution — a build ingested before they were carried, or a
 * run that composed no census — and every state it can return still gets its own
 * clause, because a component nothing draws and a component nobody measured are
 * different facts.
 */
function Undeclared({
  build,
  moved,
}: {
  readonly build: BuildDetail;
  readonly moved: readonly Unplaced[];
}): ReactElement | null {
  if (moved.length === 0) return null;
  const held = heldBy(build);
  const attributed = attributionsOf(build);

  return (
    <div className="va-unheld">
      <p>
        {/* The clause after the dash is a cap, not an explanation: these are not
            in the bars, and a reader who is not told that reads the histogram as
            the whole of the movement. */}
        {count(moved.length, 'component')} no file in this commit declares — not in the bars above:
      </p>
      <ul>
        {moved.map((each) => {
          const recorded = attributed.about(each.component)[0];
          return (
            <li key={each.component} title={each.subjects.join('\n')}>
              <span className="va-unheld-name">{each.component}</span>
              <span className="va-unheld-why">
                {recorded === undefined ? (
                  drawnBy(held(each.component, each.subjects))
                ) : (
                  <Marked say={recorded.because} />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Who draws it, as the clause that follows its name. */
function drawnBy(holding: Holding): string {
  switch (holding.kind) {
    case 'unrecorded':
      return 'this run recorded no composition, so nothing here knows what draws it';
    case 'unlisted':
      return 'the run drew no boundary under this name, so nothing here knows what draws it';
    case 'outermost':
      return 'nothing in the suite draws it — wherever it appears, it is the outermost component';
    case 'enclosed':
      return `drawn by ${listing(holding.within)}, and the commit reaches none of them`;
    case 'unmeasured':
      return `drawn by ${listing(holding.within)}, and no diff was read to place them against`;
    case 'through':
      return chains(holding.by);
  }
}

/**
 * The chains, one clause each, grouped by the path they take.
 *
 * Two holders that draw a component the same way are one sentence — *MainNav and
 * NavItem draw it* — because the reviewer is being told a route, and printing
 * the route twice under two names is the same route twice.
 */
function chains(by: readonly Enclosure[]): string {
  const routes = new Map<string, { through: readonly string[]; holders: string[] }>();
  for (const each of by) {
    const route = routes.get(each.through.join(' > ')) ?? { through: each.through, holders: [] };
    route.holders.push(each.holder);
    routes.set(each.through.join(' > '), route);
  }

  return [...routes.values()]
    .map(({ through, holders }) => {
      const draws = holders.length === 1 ? 'draws' : 'draw';
      const [first, ...rest] = [...through, 'it'];
      const tail = rest.map((name) => `which draws ${name}`).join(', ');
      return `${listing(holders)} ${draws} ${first ?? 'it'}${tail === '' ? '' : `, ${tail}`}`;
    })
    .join('; ');
}

/**
 * Names as a reader would say them, and a count once there are too many to say.
 *
 * The cap is on the enclosure list, which is suite-wide: a `Card` inside forty
 * things would otherwise put forty names in a sentence whose point is that none
 * of them is the one the reviewer wants.
 */
function listing(names: readonly string[], cap = 3): string {
  if (names.length > cap) {
    return `${names.slice(0, cap).join(', ')} and ${count(names.length - cap, 'other')}`;
  }
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** One depth: everything the commit reaches there, and how much of it moved. */
function Rung({ rung, widest }: { readonly rung: Depth; readonly widest: number }): ReactElement {
  const label =
    rung.depth === 0 ? 'in a changed file' : `${count(rung.depth, 'import')} out`;

  return (
    <li className="va-rung">
      <span className="va-rung-at va-note">{label}</span>
      <span className="va-rung-bar" style={{ width: `${String((rung.reached / widest) * 100)}%` }}>
        <span
          className="va-rung-moved"
          style={{ width: `${String((rung.moved / rung.reached) * 100)}%` }}
        />
      </span>
      <span className="va-rung-num va-num">
        {number(rung.moved)}/{number(rung.reached)}
      </span>
    </li>
  );
}
