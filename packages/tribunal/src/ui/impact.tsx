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
import type { Crossing } from './crossing.js';
import { spreadOf, type Depth } from './distance.js';
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
      {spread.undeclared.length === 0 ? null : (
        <p className="va-moved-lost">
          {count(spread.undeclared.length, 'component')} moved that no file in this commit declares,
          so no rung above holds them: {spread.undeclared.join(', ')}.
        </p>
      )}
      {spread.throughUnread === 0 ? null : (
        <p className="va-note">
          {count(spread.throughUnread, 'component')} reached only through a file the scan could not
          read, so their depth is measured from the blind spot rather than from the edit — they are
          not counted above.
        </p>
      )}
    </div>
  );
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
