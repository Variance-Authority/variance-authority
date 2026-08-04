import { useMemo, useState, type ReactElement } from 'react';
import type { SubjectView } from '../review.js';
import type { ReviewClient } from './client.js';

/**
 * Looking at the change: the modes, the region overlay, and which of them a build
 * can actually offer.
 *
 * Apart from [`review.tsx`](./review.tsx) because the two answer different
 * questions and are read in that order. The docket decides *what is worth looking
 * at* and is the part of this surface that refuses the category's habit;
 * everything here is the looking itself, and is reached only once that question
 * has been answered. It is also the only part of the surface with state of its
 * own — a mode and a wipe position — which is why none of it is needed to render
 * a build list.
 */

export type ViewerMode = 'regions' | 'swipe' | 'onion' | 'side-by-side' | 'diff';

/**
 * The comparison, with the region overlay as the default view.
 *
 * The other modes are the category's and are kept because they are genuinely
 * useful for a change you already understand. The default is not one of them: a
 * reviewer arriving at a subject should first be told *which boxes moved and who
 * owns them*, because that is the question a screenshot cannot answer and the one
 * that decides whether the change is the one somebody meant to make.
 */
export function Viewer({
  client,
  build,
  subject,
}: {
  readonly client: ReviewClient;
  readonly build: string;
  readonly subject: SubjectView;
}): ReactElement {
  const available = useMemo(() => modesFor(subject), [subject]);
  const [mode, setMode] = useState<ViewerMode>(available[0] ?? 'regions');
  const [wipe, setWipe] = useState(50);

  if (available.length === 0) {
    return <p className="va-note">This run kept no images for this subject.</p>;
  }

  const url = (kind: 'before' | 'after' | 'diff'): string =>
    client.imageUrl(build, subject.subject, kind);

  return (
    <div className="va-viewer">
      <p className="va-modes">
        {available.map((option) => (
          <button
            key={option}
            type="button"
            className={option === mode ? 'va-mode va-current' : 'va-mode'}
            onClick={() => setMode(option)}
          >
            {option}
          </button>
        ))}
      </p>

      {mode === 'regions' ? (
        <figure className="va-frame">
          {subject.has.after ? <img src={url('after')} alt={`${subject.subject} after`} /> : null}
          <RegionOverlay subject={subject} />
        </figure>
      ) : null}

      {mode === 'side-by-side' ? (
        <div className="va-side-by-side">
          <figure>
            <figcaption>baseline</figcaption>
            <img src={url('before')} alt={`${subject.subject} baseline`} />
          </figure>
          <figure>
            <figcaption>this build</figcaption>
            <img src={url('after')} alt={`${subject.subject} candidate`} />
          </figure>
        </div>
      ) : null}

      {mode === 'swipe' ? (
        <>
          <figure className="va-frame va-swipe">
            <img src={url('before')} alt={`${subject.subject} baseline`} />
            <div className="va-swipe-top" style={{ width: `${String(wipe)}%` }}>
              <img src={url('after')} alt={`${subject.subject} candidate`} />
            </div>
          </figure>
          <input
            type="range"
            min={0}
            max={100}
            value={wipe}
            aria-label="wipe between baseline and candidate"
            onChange={(event) => setWipe(Number(event.target.value))}
          />
        </>
      ) : null}

      {mode === 'onion' ? (
        <>
          <figure className="va-frame">
            <img src={url('before')} alt={`${subject.subject} baseline`} />
            <img
              className="va-overlaid"
              src={url('after')}
              alt={`${subject.subject} candidate`}
              style={{ opacity: wipe / 100 }}
            />
          </figure>
          <input
            type="range"
            min={0}
            max={100}
            value={wipe}
            aria-label="fade between baseline and candidate"
            onChange={(event) => setWipe(Number(event.target.value))}
          />
        </>
      ) : null}

      {mode === 'diff' ? (
        <figure className="va-frame">
          <img src={url('diff')} alt={`${subject.subject} difference mask`} />
        </figure>
      ) : null}

      <p className="va-pixels">
        {subject.changedPixels} pixels differ
        {subject.truncated === undefined ? null : (
          <>
            {' '}
            · {subject.truncated.regions} further regions ({subject.truncated.pixels}px) were not
            recorded
          </>
        )}
        {subject.missingFonts === undefined || subject.missingFonts.length === 0 ? null : (
          <> · fonts missing at render: {subject.missingFonts.join(', ')}</>
        )}
      </p>
    </div>
  );
}

/**
 * Region rectangles over the candidate, cause and collateral drawn apart.
 *
 * Positioned in percentages of the raster's own dimensions, which the build
 * carries, rather than of the rendered element. Measuring the image in the
 * browser would place every box correctly only after it had loaded, and wrongly
 * for the frame before that — and a box in the wrong place is worse than no box,
 * because it attributes a change to whatever it happens to land on.
 */
export function RegionOverlay({ subject }: { readonly subject: SubjectView }): ReactElement | null {
  const size = subject.size;
  if (size === undefined || subject.regions.length === 0) return null;

  return (
    <div className="va-regions">
      {subject.regions.map((region, index) => (
        <span
          key={`${String(region.x)}-${String(region.y)}-${String(index)}`}
          className={region.cause ? 'va-region va-cause' : 'va-region va-collateral'}
          style={{
            left: `${String((region.x / size.width) * 100)}%`,
            top: `${String((region.y / size.height) * 100)}%`,
            width: `${String((region.width / size.width) * 100)}%`,
            height: `${String((region.height / size.height) * 100)}%`,
          }}
        >
          <span className="va-region-label">
            {region.component ?? 'unattributed'}
            {region.cause ? '' : ' (collateral)'}
            {region.where === undefined ? '' : ` — ${region.where}`}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Which comparisons this build can actually offer.
 *
 * Derived from what the run kept rather than offered unconditionally: a mode
 * whose image does not exist renders a broken frame, and a broken frame in a
 * review surface reads as a subject that renders to nothing.
 */
export function modesFor(subject: SubjectView): readonly ViewerMode[] {
  const modes: ViewerMode[] = [];
  if (subject.has.after && subject.size !== undefined && subject.regions.length > 0) {
    modes.push('regions');
  }
  if (subject.has.before && subject.has.after) modes.push('swipe', 'onion', 'side-by-side');
  if (subject.has.diff) modes.push('diff');
  if (modes.length === 0 && subject.has.after) modes.push('regions');
  return modes;
}
