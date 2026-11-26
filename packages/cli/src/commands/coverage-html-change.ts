// compass: variance-authority.reach.crossings
/**
 * The coverage page's first section: what the change did since the base.
 *
 * A pull request's reader opens the page to see the change, so it comes before
 * the census. Every figure is a field of {@link Coverage}: the counts at the base
 * and now, each suite's {@link SuiteChange}, and the test files whose reach it
 * names. Nothing is counted that the answer does not already hold; the parts of
 * a change are only added up, signed as `coverageParts` signs them.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { MovedRegion, TestFileMotion } from '@variance-authority/sense/test-selection';
import { files, grouped, paired, ratio, short, startedStopped } from './coverage-summary.js';
import { section, text } from './report-html-elements.js';
import type { Coverage } from './coverage.js';

/** How many moved files a list shows before the rest fold away. */
const SHOWN = 10;

/** The section, or why there is nothing to compare. */
export function changeSection(answer: Coverage): string {
  const suites = paired(answer);
  const compared = suites.filter(({ suite }) => suite.base !== undefined);
  const hint = compared.length === 0 ? '' : `since ${[...new Set(compared.map(({ suite }) => short(suite.base!.commit)))].join(' · ')}`;
  const body: string[] = [];
  if (compared.length === 0) {
    body.push('<p class="note" data-row="change:none">no suite has a base to compare with, so the page shows what ran, not what changed</p>');
  } else if (answer.base !== undefined) {
    body.push(
      `<p class="whole" data-row="change:whole"><b>${text(`${ratio(answer.base.run, answer.base.regions)} → ${ratio(answer.count.run, answer.count.regions)}`)}</b>` +
        `<span>${text(`regions run, of ${grouped(answer.count.regions)} any suite loaded`)}</span></p>`,
    );
  }
  const widest = Math.max(1, ...compared.map(({ suite }) => {
    const { started, stopped } = startedStopped(suite.base!.change);
    return Math.max(started, stopped);
  }));
  const rows = suites.map(({ suite, now, was }) => {
    const name = suite.suite ?? 'the record';
    const head = `<div class="suite" data-row="${text(`change:${name}`)}"><code>${text(name)}</code>`;
    if (now === undefined) return `${head}<span class="nil">unrecorded</span></div>`;
    if (suite.base === undefined) return `${head}<span class="nil">${text(suite.baseMissed ?? 'no base')}</span></div>`;
    const { started, stopped } = startedStopped(suite.base.change);
    const before = was === undefined || answer.base === undefined ? '' : `${ratio(was.run, answer.base.regions)} → `;
    return (
      `${head}<b>${text(`${before}${ratio(now.run, answer.count.regions)}`)}</b>` +
      (started + stopped === 0
        ? '<span class="moves nil">no region started or stopped running</span></div>'
        : diverge(started, stopped, widest) +
          `<span class="moves"><span class="up">${text(`+${grouped(started)} started`)}</span> <span class="down">${text(`−${grouped(stopped)} stopped`)}</span></span></div>`)
    );
  });
  if (compared.length > 0 || suites.length > 1) body.push(`<div class="suites">${rows.join('')}</div>`);
  const motions = compared.flatMap(({ suite }) => suite.base!.change.testFiles.map((motion) => ({ suite: suite.suite, motion })));
  body.push(movedTests(motions), touchedFiles(motions.map(({ motion }) => motion)), alert(answer));
  return section('This change', hint, body.join(''));
}

/** Started to the right of the axis and stopped to its left, each in proportion to the widest suite. */
function diverge(started: number, stopped: number, widest: number): string {
  const width = (n: number) => `${((n / widest) * 100).toFixed(1)}%`;
  return (
    '<span class="diverge" aria-hidden="true">' +
    `<span class="side down"><i style="width:${width(stopped)}"></i></span>` +
    `<span class="side up"><i style="width:${width(started)}"></i></span></span>`
  );
}

/** The test files whose reach moved, most moved first. */
function movedTests(motions: readonly { readonly suite: string | undefined; readonly motion: TestFileMotion }[]): string {
  if (motions.length === 0) return '';
  const moved = (motion: TestFileMotion) => motion.entered.length + motion.left.length;
  const rows = [...motions]
    .sort((a, b) => moved(b.motion) - moved(a.motion) || codeUnitOrder(a.motion.file, b.motion.file))
    .map(({ suite, motion }) => line(`moved:${suite ?? ''}:${motion.file}`, motion.file, motion.entered.length, motion.left.length, suite));
  return listed('Test files whose reach moved', 'regions each began and stopped calling into', rows);
}

/** The source files whose regions some test file began or stopped calling into, each region counted once. */
function touchedFiles(motions: readonly TestFileMotion[]): string {
  const byFile = new Map<string, { entered: Set<string>; left: Set<string> }>();
  const add = (regions: readonly MovedRegion[], side: 'entered' | 'left') => {
    for (const region of regions) {
      const held = byFile.get(region.file) ?? { entered: new Set<string>(), left: new Set<string>() };
      held[side].add(`${region.name}:${region.startLine}-${region.endLine}`);
      byFile.set(region.file, held);
    }
  };
  for (const motion of motions) {
    add(motion.entered, 'entered');
    add(motion.left, 'left');
  }
  if (byFile.size === 0) return '';
  const rows = [...byFile]
    .sort(([a, x], [b, y]) => y.entered.size + y.left.size - (x.entered.size + x.left.size) || codeUnitOrder(a, b))
    .map(([file, { entered, left }]) => line(`touched:${file}`, file, entered.size, left.size));
  return listed('Source files whose regions moved', 'regions a test file began and stopped calling into', rows);
}

function line(row: string, file: string, entered: number, left: number, suite?: string | undefined): string {
  return (
    `<li data-row="${text(row)}"><span class="file">${text(file)}</span>` +
    (suite === undefined ? '' : `<span class="mark area">${text(suite)}</span>`) +
    `<span class="moves">${entered === 0 ? '' : `<span class="up">+${grouped(entered)}</span>`}${left === 0 ? '' : ` <span class="down">−${grouped(left)}</span>`}</span></li>`
  );
}

/** The first rows, and the rest one tap away: the list is whole, only folded. */
function listed(title: string, hint: string, rows: readonly string[]): string {
  const rest = rows.length > SHOWN
    ? `<details class="more"><summary>${text(`${grouped(rows.length - SHOWN)} more`)}</summary><ul class="moved">${rows.slice(SHOWN).join('')}</ul></details>`
    : '';
  return `<h3>${text(title)}<span class="hint">${text(hint)}</span></h3><ul class="moved">${rows.slice(0, SHOWN).join('')}</ul>${rest}`;
}

/** What no suite loads, as one line that leads to its table. */
function alert(answer: Coverage): string {
  const none = answer.source?.unloaded;
  if (none === undefined || none.files === 0) return '';
  return (
    `<p class="alert" data-row="alert:unloaded"><a href="#Not-loaded">` +
    `${text(`${grouped(none.regions)} regions in ${files(none.files)} no suite loads`)}</a></p>`
  );
}

/** What only this section draws. */
export const CHANGE_STYLE = `
.whole{display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline;margin:.4rem 0 .8rem}
.whole b{font-size:22px;color:var(--ivory);font-variant-numeric:tabular-nums}
.whole span{color:var(--quiet);font-size:12px}
.suites .suite{display:grid;grid-template-columns:minmax(6rem,auto) auto 1fr auto;gap:.75rem;align-items:center;
padding:.4rem 0;border-bottom:1px solid var(--hairline);font-size:12px}
.suites .suite b{font-variant-numeric:tabular-nums;color:var(--ivory)}
.suites .suite .nil{grid-column:2/5}
.diverge{display:flex;height:8px;min-width:6rem}
.diverge .side{flex:1;display:flex}
.diverge .down{justify-content:flex-end;border-right:1px solid var(--quiet)}
.diverge .down i{background:var(--orange)}
.diverge .up i{background:var(--green)}
.diverge i{display:block;height:100%}
.moves{font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:12px;white-space:nowrap}
.moves .up{color:var(--green)}
.moves .down{color:var(--orange)}
ul.moved{list-style:none;margin:.4rem 0;padding:0}
ul.moved li{display:flex;gap:.6rem;align-items:baseline;padding:.25rem 0;border-bottom:1px solid #ffffff0a}
ul.moved li .file{flex:1;overflow-wrap:anywhere}
details.more summary{cursor:pointer;color:var(--warm);font-size:12px}
.alert{margin:1rem 0 0;padding:.5rem .75rem;border-left:3px solid var(--orange);background:var(--panel);font-size:13px}
.alert a{color:var(--ivory)}
`;
