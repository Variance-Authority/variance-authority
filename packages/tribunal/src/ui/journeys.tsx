/**
 * Where this run's subjects parted in the source, turned to face the subject.
 *
 * `variance journeys` prints the record per module: the file, its observers,
 * and the regions some of them entered and the rest did not. A reviewer on the
 * run page has a subject in mind, not a file — `story:cart-card--removing`
 * moved, and the question is what this one did that its neighbours did not —
 * so the same rows are turned round. For each subject: the regions it entered
 * that another observer missed, and the ones it missed that another observer
 * entered. Nothing is computed that the report did not carry; the whole panel
 * is a filter over `found`.
 *
 * ## The pool is drawn even when nothing parted
 *
 * No parted region is two different sentences. Over a pool of five it is the
 * five taking the same path through every module they share. Over a pool of
 * one it is nothing at all: a parting is two observers of one module taking
 * different paths, and one observer cannot part from anybody. The CLI says
 * which, and so does this.
 */

import type { ReactElement } from 'react';
import type { JourneyRegionRecord, JourneysReport } from '@variance-authority/report';
import type { BuildDetail, SubjectView } from '../review-types.js';
import { count, number } from './text.js';

/** One region, seen from one subject's side of it. */
export interface PartingRow {
  readonly file: string;
  readonly region: JourneyRegionRecord;
  /** The co-observers on the other side of it. */
  readonly others: readonly string[];
}

export interface SubjectPartings {
  readonly subject: string;
  /** Regions this subject entered that at least one co-observer did not. */
  readonly entered: readonly PartingRow[];
  /** Regions at least one co-observer entered that this subject did not. */
  readonly missed: readonly PartingRow[];
}

/**
 * The module rows turned round, changed subjects first.
 *
 * Only a subject with a row is listed. One in the pool that parted from nobody
 * has nothing to say here, and the pool line already counts it — listing it
 * with two empty lists would read as a finding.
 */
export function partingsOf(
  journeys: JourneysReport,
  subjects: readonly SubjectView[],
): readonly SubjectPartings[] {
  const rows = new Map<string, { readonly entered: PartingRow[]; readonly missed: PartingRow[] }>();
  const of = (subject: string): { readonly entered: PartingRow[]; readonly missed: PartingRow[] } => {
    const found = rows.get(subject);
    if (found !== undefined) return found;
    const made = { entered: [], missed: [] };
    rows.set(subject, made);
    return made;
  };

  for (const module of journeys.found) {
    for (const region of module.parted) {
      for (const subject of region.entered) {
        of(subject).entered.push({ file: module.file, region, others: region.missed });
      }
      for (const subject of region.missed) {
        of(subject).missed.push({ file: module.file, region, others: region.entered });
      }
    }
  }

  const verdicts = new Map(subjects.map((subject) => [subject.subject, subject.verdict]));
  const rank = (subject: string): number => (verdicts.get(subject) === 'changed' ? 0 : 1);

  return [...rows.entries()]
    .map(([subject, { entered, missed }]) => ({ subject, entered, missed }))
    .sort((a, b) => rank(a.subject) - rank(b.subject) || a.subject.localeCompare(b.subject));
}

/** How many subjects are drawn before the rest are counted. */
const SUBJECTS = 8;

/** How many rows of one list are drawn before the rest are counted. */
const ROWS = 6;

export function JourneysPanel({ build }: { readonly build: BuildDetail }): ReactElement | null {
  const journeys = build.journeys;
  if (journeys === null) return null;

  const partings = partingsOf(journeys, build.subjects);
  const shown = partings.slice(0, SUBJECTS);
  const unentered = journeys.found.flatMap((module) =>
    module.unentered.map((region) => ({ file: module.file, region })),
  );

  return (
    <section className="va-journeys">
      <h2>Where the subjects took different paths</h2>
      <p className="va-subtitle">
        <Pool journeys={journeys} />
      </p>

      {partings.length > 0 ? null : <p className="va-note">{nothingParted(journeys)}</p>}

      {shown.map((parting) => (
        <section className="va-band" key={parting.subject}>
          <h3>{parting.subject}</h3>
          <Rows
            title="entered, and another subject of this module did not"
            side="missed by"
            rows={parting.entered}
          />
          <Rows
            title="did not enter, and another subject did"
            side="entered by"
            rows={parting.missed}
          />
        </section>
      ))}
      {partings.length <= shown.length ? null : (
        <p className="va-note">
          {count(partings.length - shown.length, 'further subject')} parted, not listed.
        </p>
      )}

      {unentered.length === 0 ? null : (
        <p className="va-note va-reach-note">
          Regions no subject entered:{' '}
          {unentered.slice(0, ROWS).map((entry, index) => (
            <span key={`${entry.file}:${String(entry.region.startLine)}`}>
              {index === 0 ? null : ', '}
              <code>
                {entry.region.kind} {entry.region.name}
              </code>{' '}
              {lines(entry.region)} in <code>{entry.file}</code>
            </span>
          ))}
          {unentered.length <= ROWS ? '.' : `, and ${number(unentered.length - ROWS)} more.`}
        </p>
      )}
    </section>
  );
}

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
      .{' '}
      {journeys.truncated.length === 0
        ? null
        : `${count(journeys.truncated.length, 'subject')} cut short, and not counted. `}
      {journeys.unrecorded.length === 0
        ? null
        : `${count(journeys.unrecorded.length, 'subject')} with no journal at all. `}
    </>
  );
}

/** `found` empty, said as the sentence the pool supports. */
function nothingParted(journeys: JourneysReport): string {
  if (journeys.whole.length < 2) {
    return (
      'Two subjects can only take different paths through a module they share, and this run ' +
      'has one with a complete journal — so nothing here says they agreed.'
    );
  }
  return `All ${number(journeys.whole.length)} took the same path through every module they share.`;
}

function Rows({
  title,
  side,
  rows,
}: {
  readonly title: string;
  readonly side: string;
  readonly rows: readonly PartingRow[];
}): ReactElement | null {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, ROWS);

  return (
    <>
      <p className="va-note">{title}</p>
      <ul className="va-journey-rows">
        {shown.map((row) => (
          <li key={`${row.file}:${String(row.region.startLine)}`}>
            <code>
              {row.region.kind} {row.region.name}
            </code>{' '}
            <span className="va-note">
              {lines(row.region)} in <code>{row.file}</code> · {side} {row.others.join(', ')}
            </span>
          </li>
        ))}
      </ul>
      {rows.length <= shown.length ? null : (
        <p className="va-note">{count(rows.length - shown.length, 'more region')} not listed.</p>
      )}
    </>
  );
}

/** The CLI's line span, so a reader moving between the two sees one coordinate. */
function lines(region: JourneyRegionRecord): string {
  return region.startLine === region.endLine
    ? `line ${String(region.startLine)}`
    : `lines ${String(region.startLine)}–${String(region.endLine)}`;
}
