/**
 * Non-semantic wrapper collapse — and the place where the corpus discovered that
 * the rule as written in spec §4.2 is not quite true.
 *
 * The spec says wrappers with "no role, no visual effect on the box tree" are
 * collapsed. Refactors that add or remove a `<div>` are constant in React
 * codebases, so this has to work or P1 fails on the most common no-op there is.
 * The trouble is that *whether* a `<div>` has an effect on the box tree is not a
 * property of the `<div>`. It is a property of its parent's formatting context:
 *
 * - **block flow** — an extra `<div>` with no padding, border, or background is
 *   genuinely inert. Margins collapse through it, the leaf lands in the same
 *   place, and both profiles should call it a no-op.
 * - **flex row** — the wrapper *becomes* the flex item and the leaf stops being
 *   one. Gap now applies between wrappers, and the leaves resize. Under `chromium`
 *   the rects move and it is a real `geometry` change; under `jsdom`, which has no
 *   layout engine, it is indistinguishable from the block case and reads as a
 *   no-op. Same edit, two defensible answers, decided by the observation profile.
 * - **flex row, `display: contents`** — the wrapper generates no box, the leaves
 *   stay flex items, and it is inert again.
 *
 * The middle case is left in the corpus with its ground truth marked contested
 * rather than resolved, because resolving it is a decision for the collector
 * design, not for a fixture. See the journal.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Fragment } from 'react';

export interface WrappersProps {
  /** How many non-semantic `<div>`s to interpose between container and leaf. */
  readonly depth: number;
  /** `contents` makes the wrappers generate no box at all. */
  readonly display: 'block' | 'contents';
  /** Which formatting context receives the wrappers. */
  readonly target: 'block' | 'flex' | 'none';
}

function wrap(depth: number, display: 'block' | 'contents', child: ReactNode): ReactNode {
  let out = child;
  const style: CSSProperties | undefined = display === 'contents' ? { display: 'contents' } : undefined;
  for (let i = 0; i < depth; i += 1) {
    out = (
      <div style={style} key={`w${i}`}>
        {out}
      </div>
    );
  }
  return out;
}

const LEAVES = ['one', 'two', 'three'] as const;

export function Wrappers({ depth, display, target }: WrappersProps) {
  const leaves = LEAVES.map((label) => (
    <p className="ks-wrappers__leaf" key={label}>
      Leaf {label}
    </p>
  ));

  return (
    <div className="ks-wrappers">
      <div className="ks-wrappers__block">
        {leaves.map((leaf, i) => (
          <Fragment key={`b${i}`}>{target === 'block' ? wrap(depth, display, leaf) : leaf}</Fragment>
        ))}
      </div>
      <div className="ks-wrappers__flex">
        {leaves.map((leaf, i) => (
          <Fragment key={`f${i}`}>{target === 'flex' ? wrap(depth, display, leaf) : leaf}</Fragment>
        ))}
      </div>
    </div>
  );
}

Wrappers.displayName = 'Wrappers';
