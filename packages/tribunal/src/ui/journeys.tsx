/**
 * Where this run's subjects parted in the source, read as one story against its
 * siblings.
 *
 * `variance journeys` prints the record per module: the file, its observers,
 * and the regions some of them entered and the rest did not. Printed as it is,
 * the record is mostly the wrong comparison. A button story and a cart story
 * part in `CartContext.tsx` because one is a button and the other is a cart,
 * and a page that listed that under every subject would be a page of
 * component names. The comparison that says something is between the stories
 * of *one* component: `cart-card--removing` against `cart-card--item`, where
 * the only region between them is the click handler — or `product-card--sale`
 * against `product-card--control`, where there is none at all, and the arm is
 * not only rendering the control but executing it.
 *
 * So the pool is cut into families, one per component, and each family is one
 * grid: its stories across, and down, only the regions on which they parted.
 * A region the family agrees on is not a row, whichever other family it parts
 * from. The columns follow the variation lattice where the run found one, so
 * an arm sits beside what it varies from. Nothing is computed that the report
 * did not carry; the grid is a filter over `found`.
 *
 * ## The pool is drawn even when nothing parted
 *
 * No row is two different sentences. Over a family of four it is the four
 * taking the same path through every module they share. Over a pool of one it
 * is nothing at all: a parting is two observers of one module taking different
 * paths, and one observer cannot part from anybody. The CLI says which, and so
 * does this.
 */

import type { ReactElement } from 'react';
import type { JourneyRegionRecord, JourneysReport, VariationRecord } from '@variance-authority/report';
import type { BuildDetail } from '../review-types.js';
import { count } from './text.js';

/** One story of a family, as a column of its grid. */
export interface JourneyColumn {
  readonly subject: string;
  /** The part of the id that names it within the family. */
  readonly member: string;
  /** The member it varies from, when the run read the two as a pair. */
  readonly from?: string;
}

/** What one column did with one row. `absent` is a module it never entered. */
export type JourneyCell = 'entered' | 'missed' | 'absent';

export interface JourneyRow {
  readonly file: string;
  /** `null` is the module itself: some of the family entered it, the rest did not. */
  readonly region: JourneyRegionRecord | null;
  /** One per column, in column order. */
  readonly cells: readonly JourneyCell[];
}

export interface JourneyFamily {
  readonly name: string;
  readonly columns: readonly JourneyColumn[];
  /** Empty for a family that took one path. */
  readonly rows: readonly JourneyRow[];
}

/** `story:cart-card--item` is `story:cart-card` and `item`; an id with no `--` is its own family. */
function split(id: string): { readonly family: string; readonly member: string } {
  const at = id.indexOf('--');
  return at < 0 ? { family: id, member: id } : { family: id.slice(0, at), member: id.slice(at + 2) };
}

/**
 * The family's members in the lattice's order: what nothing varies from first,
 * then what varies from it, depth first, each rank by name.
 */
function columnsOf(
  members: readonly { readonly subject: string; readonly member: string }[],
  variations: readonly VariationRecord[],
): readonly JourneyColumn[] {
  const own = new Map(members.map((member) => [member.subject, member.member]));
  const parents = new Map<string, string>();
  for (const variation of variations) {
    if (variation.parent !== undefined && own.has(variation.subject) && own.has(variation.parent)) {
      parents.set(variation.subject, variation.parent);
    }
  }
  const byName = (a: { readonly member: string }, b: { readonly member: string }): number =>
    a.member.localeCompare(b.member);
  const armsOf = (parent: string | undefined): readonly JourneyColumn[] =>
    members
      .filter((member) => parents.get(member.subject) === parent)
      .sort(byName)
      .flatMap((member): readonly JourneyColumn[] => {
        const from = parent === undefined ? undefined : own.get(parent);
        return [
          from === undefined ? { subject: member.subject, member: member.member } : { ...member, from },
          ...armsOf(member.subject),
        ];
      });
  return armsOf(undefined);
}

/**
 * The pool cut into families, each with the rows on which it parted.
 *
 * Families that parted come first, most rows first; the rest by name. A family
 * of one is returned with its one column and no rows, so the panel can count it
 * as what it is — a story with no sibling to compare with — rather than as a
 * family that agreed.
 */
export function familiesOf(
  journeys: JourneysReport,
  variations: readonly VariationRecord[],
): readonly JourneyFamily[] {
  const grouped = new Map<string, { readonly subject: string; readonly member: string }[]>();
  for (const subject of journeys.whole) {
    const { family, member } = split(subject);
    grouped.set(family, [...(grouped.get(family) ?? []), { subject, member }]);
  }

  return [...grouped.entries()]
    .map(([name, members]) => {
      const columns = columnsOf(members, variations);
      return { name, columns, rows: columns.length < 2 ? [] : rowsOf(journeys, columns) };
    })
    .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
}

/** The module rows this family is split by: the module itself, then its parted regions. */
function rowsOf(journeys: JourneysReport, columns: readonly JourneyColumn[]): readonly JourneyRow[] {
  const rows: JourneyRow[] = [];
  // Some entered and some did not. A column that never entered the module is
  // `absent` on every region row and is not a split on its own: the module row
  // already says it.
  const splits = (cells: readonly JourneyCell[]): boolean =>
    cells.includes('entered') && cells.includes('missed');

  for (const module of journeys.found) {
    const observers = new Set(module.observers);
    const observed = columns.map((column): JourneyCell => (observers.has(column.subject) ? 'entered' : 'missed'));
    if (splits(observed)) rows.push({ file: module.file, region: null, cells: observed });

    for (const region of module.parted) {
      const entered = new Set(region.entered);
      const missed = new Set(region.missed);
      const cells = columns.map((column): JourneyCell =>
        entered.has(column.subject) ? 'entered' : missed.has(column.subject) ? 'missed' : 'absent',
      );
      if (splits(cells)) rows.push({ file: module.file, region, cells });
    }
  }
  return rows;
}

/** How many families are drawn before the rest are counted. */
const FAMILIES = 6;

/** How many rows of one grid are drawn before the rest are counted. */
const ROWS = 8;

export function JourneysPanel({ build }: { readonly build: BuildDetail }): ReactElement | null {
  const journeys = build.journeys;
  if (journeys === null) return null;

  const families = familiesOf(journeys, build.variations);
  const parted = families.filter((family) => family.rows.length > 0);
  const agreed = families.filter((family) => family.rows.length === 0 && family.columns.length > 1);
  const alone = families.filter((family) => family.columns.length === 1);
  const unentered = journeys.found.flatMap((module) =>
    module.unentered.map((region) => ({ file: module.file, region })),
  );

  return (
    <section className="va-journeys">
      <h2>Where the subjects took different paths</h2>
      <p className="va-subtitle">
        <Pool journeys={journeys} />
      </p>

      {journeys.whole.length >= 2 ? null : <p className="va-note">{ONE}</p>}

      {parted.slice(0, FAMILIES).map((family) => (
        <Grid family={family} key={family.name} />
      ))}
      {parted.length <= FAMILIES ? null : (
        <p className="va-note">
          {count(parted.length - FAMILIES, 'further component')} with stories that took different
          paths, not listed.
        </p>
      )}

      {agreed.length === 0 ? null : (
        <p className="va-note">
          Stories that took one path through every module they share:{' '}
          {agreed.map((family, index) => (
            <span key={family.name}>
              {index === 0 ? null : ', '}
              <code>{family.name}</code> ({count(family.columns.length, 'subject')})
            </span>
          ))}
          .
        </p>
      )}
      {alone.length === 0 || journeys.whole.length < 2 ? null : (
        <p className="va-note">
          {count(alone.length, 'subject is', 'subjects are')} the only story of{' '}
          {alone.length === 1 ? 'its' : 'their'} component, so there is nothing to compare{' '}
          {alone.length === 1 ? 'it' : 'them'} with.
        </p>
      )}

      {unentered.length === 0 ? null : (
        <details className="va-journey-unentered">
          <summary>{count(unentered.length, 'region')} no subject entered</summary>
          <ul className="va-journey-rows">
            {unentered.map((entry) => (
              <li key={`${entry.file}:${String(entry.region.startLine)}`}>
                <code>
                  {entry.region.kind} {entry.region.name}
                </code>{' '}
                <span className="va-note">
                  {lines(entry.region)} in <code>{entry.file}</code>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** A pool of one, said apart from a pool that agreed. */
const ONE =
  'Only one subject has a complete journal, so there is nothing to compare — and no agreement ' +
  'to report.';

function Pool({ journeys }: { readonly journeys: JourneysReport }): ReactElement {
  return (
    <>
      {count(journeys.whole.length, 'subject')} of this run{' '}
      {journeys.whole.length === 1 ? 'has' : 'have'} a complete journal, recorded{' '}
      {journeys.commit === undefined ? (
        'outside a checkout'
      ) : (
        <>
          at <code>{journeys.commit.slice(0, 12)}</code>
        </>
      )}
      . Only stories of the same component are compared.{' '}
      {journeys.truncated.length === 0
        ? null
        : `${count(journeys.truncated.length, 'subject')} with a journal that ended early, not counted. `}
      {journeys.unrecorded.length === 0
        ? null
        : `${count(journeys.unrecorded.length, 'subject')} with no journal at all. `}
    </>
  );
}

const MARK: Readonly<Record<JourneyCell, string>> = { entered: '●', missed: '○', absent: '·' };

/** The cell's sentence, for a pointer resting on it and for a reader without the legend. */
function said(column: JourneyColumn, row: JourneyRow, cell: JourneyCell): string {
  if (row.region === null) {
    return cell === 'entered' ? `${column.member} entered the module` : `${column.member} did not enter the module`;
  }
  if (cell === 'absent') return `${column.member} did not enter the module`;
  return cell === 'entered' ? `${column.member} entered it` : `${column.member} did not enter it`;
}

function Grid({ family }: { readonly family: JourneyFamily }): ReactElement {
  const shown = family.rows.slice(0, ROWS);
  const width = family.columns.length + 1;

  return (
    <section className="va-band">
      <h3>{family.name}</h3>
      <div className="va-journey-scroll">
        <table className="va-journey-grid">
          <thead>
            <tr>
              <th />
              {family.columns.map((column) => (
                <th key={column.subject} scope="col" title={column.subject}>
                  {column.member}
                  {column.from === undefined ? null : <small>from {column.from}</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <Row
                row={row}
                columns={family.columns}
                first={index === 0 || shown[index - 1]?.file !== row.file}
                width={width}
                key={`${row.file}:${row.region === null ? 'module' : String(row.region.startLine)}`}
              />
            ))}
          </tbody>
        </table>
      </div>
      {family.rows.length <= shown.length ? null : (
        <p className="va-note">{count(family.rows.length - shown.length, 'more region')} not listed.</p>
      )}
    </section>
  );
}

function Row({
  row,
  columns,
  first,
  width,
}: {
  readonly row: JourneyRow;
  readonly columns: readonly JourneyColumn[];
  /** The first row of its file, which carries the file above it. */
  readonly first: boolean;
  readonly width: number;
}): ReactElement {
  return (
    <>
      {first ? (
        <tr className="va-journey-file">
          <th colSpan={width} scope="colgroup">
            <code>{row.file}</code>
          </th>
        </tr>
      ) : null}
      <tr>
        <th scope="row">
          {row.region === null ? (
            'the module itself'
          ) : (
            <>
              <code>
                {row.region.kind} {row.region.name}
              </code>{' '}
              <span className="va-note">{lines(row.region)}</span>
            </>
          )}
        </th>
        {row.cells.map((cell, index) => {
          const column = columns[index];
          return column === undefined ? null : (
            <td className={`va-journey-cell va-${cell}`} key={column.subject} title={said(column, row, cell)}>
              {MARK[cell]}
            </td>
          );
        })}
      </tr>
    </>
  );
}

/** The CLI's line span, so a reader moving between the two sees one coordinate. */
function lines(region: JourneyRegionRecord): string {
  return region.startLine === region.endLine
    ? `line ${String(region.startLine)}`
    : `lines ${String(region.startLine)}–${String(region.endLine)}`;
}
