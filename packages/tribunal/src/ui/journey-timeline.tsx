/**
 * The tree, drawn: a level trunk, and the branches leaving it at the region
 * where they left.
 *
 * Time runs left to right, in source order. The trunk is the lattice's root and
 * runs straight; at each fork a numbered mark sits on the line it leaves, with
 * the region above it, and the arm that *entered* the region is lit while the
 * one that did not stays dim. Every branch runs to the right edge and ends in
 * the names of the stories on it, so a reader follows one line from the trunk
 * to a name and has read that story's journey against its family's.
 *
 * The numbers are the list beneath the picture, where the full coordinate —
 * kind, name, lines, file — has room, and where a fork that several regions
 * make is listed with all of them. Up here a name is cut to fit its column.
 */

import type { ReactElement } from 'react';
import type { Branch, Fork, Tree } from './journey-tree.js';
import type { JourneyFamily, JourneyRow } from './journeys.js';
import { count } from './text.js';

/** Horizontal room for one divergence. */
const STEP = 176;
/** Vertical room for one branch. */
const GAP = 30;
const LEFT = 16;
const TOP = 34;
/** A fork's label, in characters, before it is cut. */
const LABEL = 24;
/** A leaf's names, in characters, before they are cut. */
const NAMES = 40;

/** The x of fork `index`; `-1` is where the trunk starts. */
function x(index: number): number {
  return LEFT + (index + 1) * STEP;
}

function y(row: number): number {
  return TOP + row * GAP + GAP / 2;
}

function cut(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/** A region as the picture names it: the name and its lines, or the file for the module row. */
export function regionLabel(row: JourneyRow): string {
  if (row.region === null) return row.file.slice(row.file.lastIndexOf('/') + 1);
  const span =
    row.region.startLine === row.region.endLine
      ? `:${String(row.region.startLine)}`
      : `:${String(row.region.startLine)}–${String(row.region.endLine)}`;
  return `${row.region.name}${span}`;
}

/**
 * A fork's label: its first region, and how many more split the family the same
 * way. Cut to `width` characters, and the count survives the cut.
 */
export function forkLabel(fork: Fork, width = Number.POSITIVE_INFINITY): string {
  const [first, ...rest] = fork.rows;
  if (first === undefined) return '';
  const more = rest.length === 0 ? '' : ` +${String(rest.length)}`;
  return `${cut(regionLabel(first), width - more.length)}${more}`;
}

/** A branch's line: a curve out of its fork, then level to where it forks or ends. */
function path(branch: Branch, parentY: number): string {
  const x0 = x(branch.from);
  const x1 = x(branch.at);
  const y0 = y(parentY);
  const y1 = y(branch.y);
  if (y0 === y1) return `M ${String(x0)} ${String(y0)} L ${String(x1)} ${String(y1)}`;
  const bend = Math.min(STEP * 0.55, x1 - x0);
  const c = bend / 2;
  return (
    `M ${String(x0)} ${String(y0)} ` +
    `C ${String(x0 + c)} ${String(y0)}, ${String(x0 + c)} ${String(y1)}, ${String(x0 + bend)} ${String(y1)} ` +
    `L ${String(x1)} ${String(y1)}`
  );
}

function Line({ branch, parentY }: { readonly branch: Branch; readonly parentY: number }): ReactElement {
  const tone = branch.cell === null ? 'va-trunk' : branch.cell === 'entered' ? 'va-lit' : 'va-dim';
  return (
    <>
      <path className={`va-timeline-line ${tone}`} d={path(branch, parentY)} />
      {branch.branches.map((child) => (
        <Line branch={child} parentY={branch.y} key={child.stories.map((story) => story.subject).join('\n')} />
      ))}
    </>
  );
}

/**
 * The marks, drawn after every line so a fork sits on top of what it forks.
 *
 * The label sits above and to the left of the mark, over the level line that
 * arrives at it: the arms leave to the right, and a label there would sit on
 * one of them.
 */
function Marks({ branch, forks }: { readonly branch: Branch; readonly forks: readonly Fork[] }): ReactElement | null {
  if (branch.branches.length === 0) return null;
  const fork = forks[branch.at];
  return (
    <>
      <g className="va-timeline-fork" transform={`translate(${String(x(branch.at))} ${String(y(branch.y))})`}>
        {fork === undefined ? null : (
          <text className="va-timeline-label" x={-11} y={-7} textAnchor="end">
            <title>{fork.rows.map((row) => regionLabel(row)).join('\n')}</title>
            {forkLabel(fork, LABEL)}
          </text>
        )}
        <circle r={7} />
        <text className="va-timeline-n" y={3.5} textAnchor="middle">
          {String(branch.at + 1)}
        </text>
      </g>
      {branch.branches.map((child) => (
        <Marks branch={child} forks={forks} key={child.stories.map((story) => story.subject).join('\n')} />
      ))}
    </>
  );
}

function Names({ branch, end }: { readonly branch: Branch; readonly end: number }): ReactElement {
  if (branch.branches.length > 0) {
    return (
      <>
        {branch.branches.map((child) => (
          <Names branch={child} end={end} key={child.stories.map((story) => story.subject).join('\n')} />
        ))}
      </>
    );
  }
  const names = branch.stories.map((story) => story.member).join(', ');
  return (
    <text className={`va-timeline-names${branch.main ? ' va-trunk' : ''}`} x={end + 10} y={y(branch.y) + 3.5}>
      <title>{branch.stories.map((story) => story.subject).join('\n')}</title>
      {cut(names, NAMES)}
    </text>
  );
}

export function Timeline({
  family,
  forks,
  tree,
}: {
  readonly family: JourneyFamily;
  readonly forks: readonly Fork[];
  readonly tree: Tree;
}): ReactElement {
  const end = x(forks.length);
  const width = end + 10 + NAMES * 6.6 + LEFT;
  const height = TOP + tree.leaves * GAP + 8;

  return (
    <div className="va-journey-scroll">
      <svg
        className="va-timeline"
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label={`${family.name}: ${count(family.columns.length, 'story', 'stories')} part at ${count(forks.length, 'region')} into ${count(tree.leaves, 'path')}`}
      >
        <Line branch={tree.root} parentY={tree.root.y} />
        <Marks branch={tree.root} forks={forks} />
        <Names branch={tree.root} end={end} />
      </svg>
    </div>
  );
}
