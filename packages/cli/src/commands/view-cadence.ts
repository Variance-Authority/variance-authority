// compass: variance-authority.reach
/**
 * The Cadence view: one point for each run the record has a summary row for,
 * its total duration against the time it landed.
 *
 * "Cadence" here is the rhythm of recorded runs, how often they land and how
 * long each took. It is not the first-test line `docs/selecting.md` calls by
 * the same word. A row whose run could not tell its duration still draws a
 * point, hollow and on the baseline, because the run happened; it is not
 * lent a duration.
 */

import { section, text } from './report-html-elements.js';
import type { CadenceData } from './view-data.js';
import { ms } from './view-tests.js';
import type { View } from './view-shell.js';

const WIDTH = 800;
const HEIGHT = 220;
const PAD = 36;

function chart(rows: CadenceData['rows']): string {
  const times = rows.map((row) => Date.parse(row.at));
  const first = Math.min(...times);
  const span = Math.max(Math.max(...times) - first, 1);
  const top = Math.max(...rows.map((row) => row.duration ?? 0), 1);
  const x = (time: number) => (rows.length === 1 ? WIDTH / 2 : PAD + ((time - first) / span) * (WIDTH - 2 * PAD));
  const y = (duration: number) => HEIGHT - PAD - (duration / top) * (HEIGHT - 2 * PAD);
  const points = rows
    .map((row, at) => {
      const tip = `${row.at}${row.suite === undefined ? '' : `\n${row.suite}`}\n${row.duration === undefined ? 'duration not recorded' : ms(row.duration)}${row.cases === undefined ? '' : `\n${row.cases} cases`}`;
      const known = row.duration !== undefined;
      return `<circle class="pt ${known ? 'dur' : 'unknown'}" cx="${x(times[at]!).toFixed(1)}" cy="${y(row.duration ?? 0).toFixed(1)}" r="4"><title>${text(tip)}</title></circle>`;
    })
    .join('');
  return (
    `<svg class="cadence" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Total duration of each recorded run over time">` +
    `<line class="base" x1="${PAD}" y1="${HEIGHT - PAD}" x2="${WIDTH - PAD}" y2="${HEIGHT - PAD}"/>` +
    `<text class="lab" x="${PAD}" y="${PAD - 12}">${text(ms(top))}</text>${points}</svg>`
  );
}

function table(rows: CadenceData['rows']): string {
  const body = rows
    .map(
      (row) =>
        `<tr><td>${text(row.at.slice(0, 16).replace('T', ' '))}</td><td>${text(row.suite ?? '')}</td>` +
        `<td class="num">${text(row.duration === undefined ? '' : ms(row.duration))}</td><td class="num">${row.cases === undefined ? '' : row.cases}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Landed</th><th>Suite</th><th class="num">Duration</th><th class="num">Cases</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** The Cadence view, or the reason there is nothing to draw. */
export function cadenceView(data: CadenceData): View {
  if (data.rows.length === 0) {
    return { id: 'cadence', label: 'Cadence', body: '<p class="note">no run has left a summary row beside this record: runs recorded from now on will.</p>' };
  }
  const hint = `${data.rows.length} recorded runs, oldest first; a run lands one row, and rows older than a few weeks go`;
  return { id: 'cadence', label: 'Cadence', body: section('Recorded runs', hint, chart(data.rows) + table(data.rows), undefined, undefined, 'part') };
}

/** What only this view draws. */
export const CADENCE_STYLE = `
.cadence{width:100%;max-width:60rem;height:auto}
.cadence .base{stroke:var(--quiet);stroke-width:1}
.cadence .lab{fill:var(--quiet);font-family:var(--mono);font-size:11px}
.cadence .pt.dur{fill:var(--accent,#7aa2f7)}
.cadence .pt.unknown{fill:none;stroke:var(--quiet);stroke-width:1.5}
`;
