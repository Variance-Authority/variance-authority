import type { ReactElement } from 'react';
import type { RegionRecord } from '@variance-authority/report';
import type { SubjectView } from '../review.js';
import { number } from './text.js';

/**
 * The boxes, and the table that names them.
 *
 * Apart from [`viewer.tsx`](./viewer.tsx) because the stage is one question — how
 * do I look at two images — and this is the other: *which of these boxes is the
 * one somebody edited, and who owns it*. The two are drawn together and read
 * together, and a reviewer moves between them constantly, which is why the focus
 * is one index shared by both rather than a hover state in each.
 *
 * The row and the rectangle are the same finding twice. Pointing at either lights
 * the other, because a rectangle 700 pixels down a route capture and a row in a
 * table are otherwise two lists a reader has to join by counting.
 */

export interface RegionFocus {
  /** Which region is lit, by report order. `null` is none. */
  readonly focus: number | null;
  readonly onFocus: (index: number | null) => void;
  /** Bring this region into view on the stage. */
  readonly onJump: (index: number) => void;
}

/**
 * Region rectangles over the candidate, cause and collateral drawn apart.
 *
 * Positioned in percentages of the raster's own dimensions, which the build
 * carries, rather than of the rendered element. Measuring the image in the
 * browser would place every box correctly only after it had loaded, and wrongly
 * for the frame before that — and a box in the wrong place is worse than no box,
 * because it attributes a change to whatever it happens to land on.
 *
 * Percentages are also what survives the zoom: the stage scales the plate and
 * every box scales with it, so nothing here has to know the magnification.
 *
 * Only the causes and whatever is under attention are named on the picture. Thirty
 * collateral captions over a page fitted to a pane overlap into a grey field, and
 * a reviewer who cannot read any of them is worse off than one reading two — so
 * the rest carry their ordinal, which is the number they are listed under, and the
 * sentence arrives on hover and in the table. Nothing is dropped: every region
 * that was found is a box and a row, both of them always.
 */
export function RegionOverlay({
  subject,
  box,
  focus,
  onFocus,
}: {
  readonly subject: SubjectView;
  /**
   * The frame the percentages are of, when it is not the candidate's own.
   *
   * Region coordinates are in the comparison's space, and a comparison pads to
   * the union of the two captures — so on a subject whose baseline was a
   * different size, the candidate's dimensions are the wrong denominator and
   * every box lands short by the difference.
   */
  readonly box?: { readonly width: number; readonly height: number } | undefined;
  readonly focus?: number | null;
  readonly onFocus?: ((index: number | null) => void) | undefined;
}): ReactElement | null {
  const size = box ?? subject.size;
  if (size === undefined || subject.regions.length === 0) return null;

  return (
    <div className="va-regions">
      {subject.regions.map((region, index) => (
        <span
          key={key(region, index)}
          className={[
            'va-region',
            region.cause ? 'va-cause' : 'va-collateral',
            focus === index ? 'va-lit' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onPointerEnter={() => onFocus?.(index)}
          onPointerLeave={() => onFocus?.(null)}
          style={{
            left: `${String((region.x / size.width) * 100)}%`,
            top: `${String((region.y / size.height) * 100)}%`,
            width: `${String((region.width / size.width) * 100)}%`,
            height: `${String((region.height / size.height) * 100)}%`,
          }}
        >
          <span className="va-region-label">
            {String(index + 1)}
            {region.cause || focus === index ? (
              <>
                {' · '}
                {region.component ?? 'unattributed'}
                {region.cause ? '' : ' (collateral)'}
                {region.where === undefined ? '' : ` — ${region.where}`}
              </>
            ) : null}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * The same regions as rows, which is the half a picture cannot deliver.
 *
 * A rectangle says *here*. It cannot say `src/ui/Button.tsx:18`, and the file is
 * the column that lets a reviewer hand the change to whoever owns it rather than
 * deciding it themselves. Ordered as the report ordered them — causes first,
 * never by area, which reports the container that reflowed instead of the
 * component that was edited.
 */
export function RegionTable({
  subject,
  sourced,
  focus,
  onFocus,
  onJump,
}: {
  readonly subject: SubjectView;
  /**
   * Whether the *run* resolved any source file at all.
   *
   * A property of the run's source index, not of one capture, and the caller who
   * holds the build is the only one who can say it. Left out, this falls back to
   * what one render can see on its own, which is strictly weaker: a capture whose
   * every region belongs to a dependency resolves nothing and would report a run
   * with no index — the same name then reads two ways on two surfaces, and a
   * reviewer takes one of them for a bug.
   */
  readonly sourced?: boolean | undefined;
} & RegionFocus): ReactElement | null {
  if (subject.regions.length === 0) return null;

  // A blank cell is the one answer this column must not give: the reviewer's next
  // move is to open the file, and nothing-at-all reads as a defect in the tool
  // when the ordinary cause is a component out of a dependency, which no source
  // index scanned or claimed to.
  const indexed = sourced ?? subject.regions.some((region) => region.file !== undefined);

  return (
    <table className="va-region-table">
      <thead>
        <tr>
          <th>region</th>
          <th>component</th>
          <th>declared in</th>
          <th className="va-num-col">pixels</th>
        </tr>
      </thead>
      <tbody>
        {subject.regions.map((region, index) => (
          <tr
            key={key(region, index)}
            className={focus === index ? 'va-lit' : undefined}
            onPointerEnter={() => onFocus(index)}
            onPointerLeave={() => onFocus(null)}
          >
            <td>
              <button type="button" className="va-region-jump" onClick={() => onJump(index)}>
                <span className={region.cause ? 'va-dot va-cause' : 'va-dot va-collateral'} />
                {String(index + 1)}
                <span className="va-region-where">
                  {region.cause ? 'cause' : 'collateral'}
                  {region.where === undefined ? '' : ` · ${region.where}`}
                </span>
              </button>
            </td>
            <td>{region.component ?? <span className="va-note">unattributed</span>}</td>
            <td>
              {region.file === undefined ? (
                <span
                  className="va-note"
                  title={
                    indexed
                      ? 'This run resolved files for other components, so this is a name its source index does not declare — a component out of a dependency, or one produced at build time.'
                      : 'This run resolved no source files at all, so nothing here says where any of these components are declared.'
                  }
                >
                  {indexed ? 'not in the scanned source' : 'no source index'}
                </span>
              ) : (
                <code>{region.file}</code>
              )}
            </td>
            <td className="va-num va-num-col">{number(region.pixels)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Position and ordinal, because two regions can be the same size in the same
 * place across renders and nothing else here is unique.
 */
function key(region: RegionRecord, index: number): string {
  return `${String(region.x)}-${String(region.y)}-${String(index)}`;
}
