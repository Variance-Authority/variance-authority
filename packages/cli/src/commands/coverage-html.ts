// compass: variance-authority.reach.crossings
/**
 * `variance coverage --format html`: the answer as one page to browse.
 *
 * The page arranges what it is handed and computes nothing the answer does not
 * already hold: every figure is a field of {@link Coverage}, and every ratio is
 * the one the text prints. It is the visual review's page in its masthead, its
 * palette and its tables, because the two are read side by side on a pull
 * request, and it is inline for the same reason that page is: an artifact is
 * opened from a browser with nothing beside it.
 */

import type { FanInFile, OwnedFile } from '@variance-authority/sense/test-selection';
import { banded, coverageParts, files, grouped, leading, paired, ratio, short } from './coverage-summary.js';
import { census, chip, section, text } from './report-html-elements.js';
import { MARK, PAGE } from './report-html-style.js';
import type { CoverageSource, Unloaded } from './coverage-source.js';
import type { Coverage } from './coverage.js';

/** The answer as one self-contained page. */
export function coverageHtml(answer: Coverage): string {
  const title = answer.at === undefined ? 'coverage' : `coverage at ${short(answer.at)}`;
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${text(`variance ${title}`)}</title>`,
    `<style>${PAGE}${STYLE}</style>`,
    '</head><body>',
    masthead(answer),
    '<main>',
    suites(answer),
    kinds(answer),
    flatFiles(answer),
    unloaded(answer),
    '</main>',
    `<script>${SCRIPT}</script>`,
    '</body></html>',
  ].join('\n');
}

function masthead(answer: Coverage): string {
  const { count } = answer;
  const lead = leading(count);
  const chips: string[] = [];
  if (answer.at !== undefined) chips.push(chip('commit', short(answer.at), answer.at));
  const recorded = answer.suites.filter((suite) => suite.from !== undefined).length;
  chips.push(chip('suites', `${recorded} of ${answer.suites.length} recorded`));
  const bases = [...new Set(answer.suites.flatMap((suite) => suite.base === undefined ? [] : [suite.base.commit]))];
  if (bases.length > 0) chips.push(chip('base', bases.map(short).join(' · '), bases.join('\n')));
  if (answer.source !== undefined) chips.push(chip('source', files(answer.source.files)));
  return (
    '<header>' +
    `<div class="brand">${MARK}<span>variance</span></div>` +
    `<h1 data-row="lead">${text(ratio(lead, count.regions))}<span>regions run</span>` +
    `<span class="more">${text(`${grouped(lead)} of ${grouped(count.regions)} regions in ${files(count.files)} the suites loaded${banded(answer)}`)}</span></h1>` +
    `<div class="chips">${chips.join('')}</div>` +
    regionBar([...ran(count), ['load', count.load, 'ran only at load'], ['none', count.none, 'nothing ran']]) +
    '</header>'
  );
}

type Part = readonly [name: string, regions: number, label: string, why?: string];

/** What cases ran, parted by the text they ran over where the count parts it, so the bar adds up to the lead. */
function ran(count: Coverage['count']): readonly Part[] {
  const { over } = count;
  if (over === undefined) return [['run', count.run, 'run by a case']];
  return [
    ['run', over.this, 'run over this text'],
    ['older', over.older, 'run over an older text'],
    ['unknown', over.notKnown, 'run over a text not known', over.why.join('\n')],
  ];
}

/** The regions as one bar of parts, each keyed with its count and, on hover, why. */
function regionBar(parts: readonly Part[]): string {
  return census(
    parts.map(([name, n, label, why]) => {
      const title = why === undefined || why === '' ? `${grouped(n)} ${label}` : `${grouped(n)} ${label}: ${why}`;
      return { name, n, title, key: `<span class="key ${name}" title="${text(title)}"><i></i><b>${grouped(n)}</b> ${text(label)}</span>` };
    }),
    'census',
  );
}

/* --- suites ----------------------------------------------------------------- */

function suites(answer: Coverage): string {
  const { count } = answer;
  const rows: string[] = [];
  for (const { suite, now } of paired(answer)) {
    const name = suite.suite ?? 'the record';
    const head = `<tr data-row="${text(`suite:${name}`)}"><td><code>${text(name)}</code></td><td>${kindMark(suite.kind)}</td>`;
    if (now === undefined) {
      rows.push(`${head}<td class="num nil" colspan="4">unrecorded</td><td></td></tr>`);
      continue;
    }
    const run = leading(now);
    const change = suite.base !== undefined
      ? `<span class="mark quiet" title="${text(suite.base.from)}">vs ${text(short(suite.base.commit))}</span>${coverageParts(suite.base.change).map(text).join(' · ')}`
      : suite.baseMissed !== undefined
        ? `<span class="nil">${text(suite.baseMissed)}</span>`
        : suite.recorded === undefined ? '' : `<span class="nil">recorded at ${text(short(suite.recorded))}</span>`;
    rows.push(
      `${head}<td class="num">${meter(run, count.regions)}${text(ratio(run, count.regions))}</td>` +
        `<td class="num">${grouped(run)}</td><td class="num">${grouped(now.load)}</td><td class="num">${grouped(now.regions)}</td>` +
        `<td>${change}</td></tr>`,
    );
  }
  const unjoined = count.unjoined === 0 ? '' : `<p class="note">${text(`${grouped(count.unjoined)} regions could not be joined across suites.`)}</p>`;
  return section(
    'Suites',
    `each over the ${grouped(count.regions)} regions any suite loaded`,
    table(['suite', 'kind', 'run', 'regions', 'only at load', 'loaded', 'since the base'], rows, [2, 3, 4, 5]) + unjoined,
  );
}

/* --- kinds ------------------------------------------------------------------ */

function kinds(answer: Coverage): string {
  const { overlap } = answer.count;
  const fanIn = answer.fanIn;
  if (overlap === undefined && (fanIn === undefined || fanIn.kinds.length === 0)) return '';
  const parts: string[] = [];
  if (overlap !== undefined) {
    const rows = [
      `<tr data-row="kinds:several"><td>more than one kind</td><td class="num">${grouped(overlap.several)}</td></tr>`,
      ...Object.entries(overlap.alone).map(
        ([kind, regions]) => `<tr data-row="${text(`kind:${kind}`)}"><td>${kindMark(kind)} alone</td><td class="num">${grouped(regions ?? 0)}</td></tr>`,
      ),
    ];
    parts.push(table(['run by', 'regions'], rows, [1]));
  }
  if (fanIn !== undefined && fanIn.kinds.length > 0) {
    const rows = fanIn.kinds.map((kind) => {
      const name = kind.kind ?? 'the record';
      return (
        `<tr data-row="${text(`fan-in:${name}`)}"><td>${kindMark(kind.kind)}</td>` +
        [kind.testFiles, kind.regions, kind.one, kind.median, kind.p90, kind.max].map((n) => `<td class="num">${grouped(n)}</td>`).join('') +
        '</tr>'
      );
    });
    parts.push(
      '<h3>Test files per region<span class="hint">how many test files call into each region a kind runs</span></h3>' +
        table(['kind', 'test files', 'regions', 'by one test', 'median', 'p90', 'most'], rows, [1, 2, 3, 4, 5, 6]),
    );
  }
  return section('Kinds', 'what each kind of test runs alone, and what several share', parts.join(''));
}

/* --- packages and files ----------------------------------------------------- */

function flatFiles(answer: Coverage): string {
  const entered = new Map((answer.fanIn?.files ?? []).map((file) => [file.file, file]));
  const owned = answer.ownership ?? [];
  const search = '<input id="filter" type="search" placeholder="filter files" aria-label="filter files" autocomplete="off">';
  if (answer.entries === undefined || owned.length === 0) {
    const listed = answer.fanIn?.files ?? [];
    if (listed.length === 0) return '';
    const rows = listed.map((file) => fileRow(file.file, file.regions, file.run, undefined, file));
    return section('Files', `${files(listed.length)} a suite loaded`, search + fileTable(rows, false));
  }
  const byOwner = new Map<string, OwnedFile[]>();
  for (const file of owned) byOwner.set(file.owner, [...(byOwner.get(file.owner) ?? []), file]);
  const blocks: string[] = [];
  for (const entry of answer.entries) {
    if ('missed' in entry) {
      blocks.push(`<div class="package missed" data-row="${text(`package:${entry.from}`)}"><code>${text(entry.from)}</code><span class="nil">${text(entry.missed)}</span></div>`);
      continue;
    }
    blocks.push(pack(entry.from, entry.own, byOwner.get(entry.from) ?? [], entered));
    byOwner.delete(entry.from);
  }
  // A file in no listed package belongs to the root; it is listed after every package.
  for (const [owner, list] of byOwner) blocks.push(pack(owner, undefined, list, entered));
  return section('Packages', 'each over its own files; open one for its files and the tests that cover them', search + blocks.join(''));
}

function pack(from: string, own: CoverageSource | undefined, list: readonly OwnedFile[], entered: ReadonlyMap<string, FanInFile>): string {
  const figure = own === undefined
    ? `<span class="num nil">${files(list.length)}</span>`
    : `<span class="num">${meter(own.ran, own.regions)}<b>${text(ratio(own.ran, own.regions))}</b></span>` +
      `<span class="num px">${grouped(own.ran)} of ${grouped(own.regions)} regions</span>` +
      `<span class="num px">${files(own.files)}</span>`;
  const rows = list.map((file) => fileRow(file.file, file.regions, file.run, file, entered.get(file.file)));
  return (
    '<details class="package">' +
    `<summary data-row="${text(`package:${from}`)}"><code>${text(from)}</code>${figure}</summary>` +
    (rows.length === 0 ? '<p class="note">no file of it was recorded</p>' : fileTable(rows, true)) +
    '</details>'
  );
}

function fileTable(rows: readonly string[], owned: boolean): string {
  const head = owned
    ? ['file', 'run', 'regions', 'by its package', 'only by others', 'test files', 'by one test', 'by kind', 'share of time']
    : ['file', 'run', 'regions', 'test files', 'by one test', 'by kind', 'share of time'];
  const numbers = owned ? [1, 2, 3, 4, 5, 6, 8] : [1, 2, 3, 4, 6];
  return table(head, rows, numbers);
}

function fileRow(file: string, regions: number, run: number, owned: OwnedFile | undefined, fan: FanInFile | undefined): string {
  const cells = [
    `<td class="file">${text(file)}</td>`,
    `<td class="num">${meter(run, regions)}${text(ratio(run, regions))}</td>`,
    `<td class="num">${grouped(run)} / ${grouped(regions)}</td>`,
  ];
  if (owned !== undefined) {
    const others = Object.entries(owned.by).map(([owner, n]) => `${owner} ${grouped(n)}`).join('\n');
    cells.push(`<td class="num">${grouped(owned.own)}</td>`, `<td class="num"${others === '' ? '' : ` title="${text(others)}"`}>${grouped(owned.others)}</td>`);
  }
  cells.push(
    fan === undefined ? '<td class="num nil">—</td>' : `<td class="num">${grouped(fan.entered)}</td>`,
    fan === undefined ? '<td class="num nil">—</td>' : `<td class="num">${grouped(fan.one)}</td>`,
    `<td>${fan?.by === undefined ? '' : Object.entries(fan.by).map(([kind, n]) => `<span class="mark band">${text(`${kind} ${grouped(n ?? 0)}`)}</span>`).join('')}</td>`,
    `<td class="num">${fan?.duration === undefined ? '<span class="nil">—</span>' : text(ratio(fan.duration, 1))}</td>`,
  );
  return `<tr data-row="${text(`file:${file}`)}">${cells.join('')}</tr>`;
}

/* --- what no suite loads ---------------------------------------------------- */

function unloaded(answer: Coverage): string {
  const { source } = answer;
  if (source === undefined) return answer.sourceMissed === undefined ? '' : section('Not loaded', `not counted, because ${answer.sourceMissed}`, '');
  if (source.unloaded.files === 0) return '';
  const { unloaded: none } = source;
  const rows = none.directories.map(
    (row) =>
      `<tr data-row="${text(`unloaded:${row.directory}`)}"><td class="file">${text(row.directory)}</td>` +
      `<td class="num">${grouped(row.files)}</td><td class="num">${grouped(row.lines)}</td><td class="num">${grouped(row.regions)}</td></tr>`,
  );
  return section('Not loaded', notLoaded(none), table(['directory', 'files', 'lines', 'regions'], rows, [1, 2, 3]));
}

function notLoaded(none: Unloaded): string {
  return `${files(none.files)}, ${grouped(none.lines)} lines and ${grouped(none.regions)} regions no suite loaded`;
}

/* --- pieces ----------------------------------------------------------------- */

function table(head: readonly string[], rows: readonly string[], numbers: readonly number[]): string {
  const ths = head.map((name, at) => `<th${numbers.includes(at) ? ' class="num"' : ''}>${text(name)}</th>`).join('');
  return `<table><thead><tr>${ths}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** A ratio drawn as a short bar; nothing when there is nothing to divide. */
function meter(run: number, regions: number): string {
  if (regions === 0) return '';
  return `<span class="meter" aria-hidden="true"><i style="width:${((run / regions) * 100).toFixed(1)}%"></i></span>`;
}

function kindMark(kind: string | undefined): string {
  return kind === undefined ? '' : `<span class="mark area">${text(kind)}</span>`;
}

/** What only this page draws: the frame, the census parts, the meters and the packages. */
const STYLE = `
main{max-width:72rem;margin:0 auto;padding:1.5rem 1.25rem 4rem}
header{padding-inline:max(1.25rem,calc((100% - 72rem) / 2 + 1.25rem))}
h1 span:first-of-type{font-weight:400;color:var(--quiet);font-size:13px}
.seg.run,.key.run i{background:var(--green)}
.seg.older,.key.older i{background:var(--green);opacity:.45}
.seg.unknown,.key.unknown i{background:var(--quiet)}
.seg.load,.key.load i{background:var(--warm)}
.seg.none{background:var(--charcoal);box-shadow:inset 0 0 0 1px var(--hairline)}
.key.none i{background:var(--hairline)}
.key{cursor:default}
.meter{display:inline-block;width:3rem;height:4px;margin-right:.5rem;vertical-align:middle;
border-radius:2px;background:var(--charcoal);overflow:hidden}
.meter i{display:block;height:100%;background:var(--green)}
#filter{width:100%;max-width:24rem;margin:0 0 .75rem;background:var(--panel);border:1px solid var(--hairline);
border-radius:5px;color:var(--ivory);font:12px/1.6 var(--mono);padding:.35rem .5rem}
#filter::placeholder{color:var(--warm)}
.package{border-bottom:1px solid var(--hairline)}
.package summary,.package.missed{display:flex;gap:1.25rem;align-items:baseline;padding:.45rem .25rem;cursor:pointer}
.package summary{list-style:none}
.package summary::-webkit-details-marker{display:none}
.package summary::before{content:'▸';color:var(--warm);width:.75rem}
.package[open] summary::before{content:'▾'}
.package summary:hover{background:var(--panel)}
.package summary code{flex:1;font-size:12px}
.package summary b{color:var(--ivory)}
.package table{margin:0 0 1rem}
`;

/** Filtering by path opens each package that holds a match, and shuts the rest again. */
const SCRIPT = `
const filter=document.getElementById('filter');
if(filter)filter.addEventListener('input',()=>{
const q=filter.value.trim().toLowerCase();
for(const row of document.querySelectorAll('tr[data-row^="file:"]'))row.classList.toggle('hidden',q!==''&&!row.dataset.row.toLowerCase().includes(q));
for(const box of document.querySelectorAll('details.package')){
const any=box.querySelector('tr[data-row^="file:"]:not(.hidden)')!==null;
box.open=q!==''&&any;box.classList.toggle('hidden',q!==''&&!any);}
});
`;
