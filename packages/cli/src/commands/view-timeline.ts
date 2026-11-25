// compass: variance-authority.reach
/**
 * The Timeline view: each recorded test file as a bar on the runner's clock,
 * its phases inside it.
 *
 * Every position is `start` and `cost` as the recording holds them, over an
 * axis from the earliest start shown to the latest end shown. A file with no
 * start is not placed, and the view counts them rather than lending them a
 * place.
 */

import { section, text } from './report-html-elements.js';
import type { TimelineData } from './view-data.js';
import { fileLink, ms } from './view-tests.js';
import type { View } from './view-shell.js';

/** The phases in the order the runner takes them, each with the colour its segment carries. */
const PHASE_CLASS = ['prepare', 'environment', 'setup', 'collect', 'cases'];

function lane(file: TimelineData['files'][number], t0: number, span: number): string {
  const start = file.start!;
  const cost = file.cost!;
  const left = ((start - t0) / span) * 100;
  const width = Math.max((cost / span) * 100, 0.15);
  const total = file.phases.reduce((sum, phase) => sum + phase.ms, 0);
  const inside = total === 0
    ? ''
    : file.phases
        .map((phase) => `<i class="ph ${text(phase.name)}" style="width:${((phase.ms / total) * 100).toFixed(2)}%" title="${text(`${phase.name} ${ms(phase.ms)}`)}"></i>`)
        .join('');
  const tip = `${file.file}\n${ms(cost)} from +${ms(start - t0)}${file.cases.length === 0 ? '' : `\n${file.cases.length} cases`}`;
  return (
    `<div class="lane" data-key="${text(file.file)}"><div class="who">${fileLink(file.file, 'test')}</div>` +
    `<div class="track"><b class="bar2" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${text(tip)}">${inside}</b></div>` +
    `<span class="px">${text(ms(cost))}</span></div>`
  );
}

/** The Timeline view, or the reason there is nothing to place. */
export function timelineView(data: TimelineData): View {
  if (data.files.length === 0) return { id: 'timeline', label: 'Timeline', body: `<p class="note">${text(data.note ?? 'nothing recorded to place')}</p>` };
  const t0 = Math.min(...data.files.map((file) => file.start!));
  const end = Math.max(...data.files.map((file) => file.start! + file.cost!));
  const span = Math.max(end - t0, 1);
  const keys = PHASE_CLASS.map((name) => `<span class="key"><i class="ph ${name}"></i>${name}</span>`).join('');
  const unplaced = data.unplaced === 0 ? '' : `<p class="note">${text(`${data.unplaced} recorded files carry no start offset, so the clock cannot place them.`)}</p>`;
  const axis = `<div class="axis"><span>0</span><span>${text(ms(span / 2))}</span><span>${text(ms(span))}</span></div>`;
  const body = `<div class="keys">${keys}</div>${unplaced}${axis}${data.files.map((file) => lane(file, t0, span)).join('')}`;
  return {
    id: 'timeline',
    label: 'Timeline',
    body: section('Files on the clock', `${data.files.length} slowest files, ordered by start; the axis spans ${ms(span)}`, body).replace('<section', '<section class="part"'),
  };
}

/** What only this view draws. */
export const TIMELINE_STYLE = `
.lane{display:grid;grid-template-columns:22rem minmax(0,1fr) 5rem;align-items:center;gap:.75rem;padding:.15rem .25rem;border-bottom:1px solid #ffffff0a}
.lane .who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.lane .who a{unicode-bidi:plaintext}
.track{position:relative;height:12px;background:var(--charcoal);border-radius:2px}
.bar2{position:absolute;top:0;bottom:0;display:flex;overflow:hidden;border-radius:2px;background:var(--hairline);min-width:2px}
.ph{display:block;height:100%}
i.ph.prepare,.key i.ph.prepare{background:var(--warm)}
i.ph.environment{background:var(--quiet)}
i.ph.setup{background:#b7923a}
i.ph.collect{background:#5f8aa6}
i.ph.cases{background:var(--green)}
.key i.ph{display:block;width:8px;height:8px;border-radius:1px}
.axis{display:flex;justify-content:space-between;margin-left:22.75rem;margin-right:5.75rem;font-family:var(--mono);font-size:10px;color:var(--warm);padding:.25rem 0}
@media (max-width:700px){.lane{grid-template-columns:1fr 4rem}.lane .track{grid-column:1/-1}.axis{margin:0}}
`;
