// compass: variance-authority.reach.crossings
/**
 * `variance coverage --fan-in`: how many test files an edit sends, read from
 * both ends.
 *
 * One row per kind gives the distribution of test files per region. Under it,
 * three short lists name the files at each end: the most regions resting on one
 * test file, the most test files called into a file, and the files selected
 * whole for far more test files than an edit to their median region would
 * need. No list carries a threshold; each is ordered, and the JSON holds every
 * file.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { FanIn, FanInFile } from '@variance-authority/sense/test-selection';
import { grouped, ratio, table } from './coverage-summary.js';

/** How many files each list names; the JSON has every file. */
const NAMED_FILES = 10;

interface List {
  readonly title: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export function fanInLines(fanIn: FanIn | undefined): readonly string[] {
  if (fanIn === undefined) return [];
  const lines = ['test files that called into each region', ...table(kindRows(fanIn))];
  for (const list of lists(fanIn.files)) {
    if (list.rows.length === 0) continue;
    lines.push(list.title, ...table([list.header.map((cell, at) => (at === 0 ? `  ${cell}` : cell)), ...list.rows.map((row) => [`  ${row[0]}`, ...row.slice(1)])]));
  }
  return lines;
}

export function fanInMarkdown(fanIn: FanIn | undefined): readonly string[] {
  if (fanIn === undefined) return [];
  const lines = [
    '',
    '<details><summary>🎯 How many test files called into each region</summary>',
    '',
    '| Kind | Test files | Regions ran | One test file |  | Median | p90 | Max |',
    '|---|--:|--:|--:|--:|--:|--:|--:|',
    ...kindRows(fanIn).slice(1).map((row) => `| ${row.map((cell, at) => (at === 0 ? cell.trim() : cell)).join(' | ')} |`),
  ];
  for (const list of lists(fanIn.files)) {
    if (list.rows.length === 0) continue;
    lines.push('', `**${list.title}**`, '', `| ${list.header.join(' | ')} |`, `|---|${list.header.slice(1).map(() => '--:').join('|')}|`);
    lines.push(...list.rows.map(([file, ...rest]) => `| \`${file}\` | ${rest.join(' | ')} |`));
  }
  lines.push('', '</details>');
  return lines;
}

function kindRows(fanIn: FanIn): (readonly string[])[] {
  return [
    ['', 'test files', 'regions ran', 'one test file', '', 'median', 'p90', 'max'],
    ...fanIn.kinds.map((row) => [
      `  ${row.kind ?? 'the record'}`,
      grouped(row.testFiles),
      grouped(row.regions),
      grouped(row.one),
      ratio(row.one, row.regions),
      grouped(row.median),
      grouped(row.p90),
      grouped(row.max),
    ]),
  ];
}

function lists(files: readonly FanInFile[]): readonly List[] {
  return [
    {
      title: 'most regions only one test file ran',
      header: ['file', 'one test file', 'of ran'],
      rows: top(files, (row) => row.one).map((row) => [row.file, grouped(row.one), grouped(row.run)]),
    },
    {
      title: 'most test files called into the file',
      header: ['file', 'test files', 'of the suites', 'of their time', 'by'],
      rows: top(files, (row) => row.entered).map((row) => [
        row.file,
        grouped(row.entered),
        percent(row.share),
        row.duration === undefined ? '' : percent(row.duration),
        row.by === undefined ? '' : Object.entries(row.by).map(([kind, count]) => `${kind} ${grouped(count ?? 0)}`).join(' · '),
      ]),
    },
    {
      title: 'selected whole beyond what its median region needs',
      header: ['file', 'beyond median', 'test files', 'median region', 'busiest region'],
      rows: top(files, (row) => row.entered - row.median).map((row) => [row.file, grouped(row.entered - row.median), grouped(row.entered), grouped(row.median), grouped(row.peak)]),
    },
  ];
}

/** The files with the largest non-zero value, largest first, ties in code-unit order. */
function top(files: readonly FanInFile[], value: (row: FanInFile) => number): readonly FanInFile[] {
  return files
    .filter((row) => value(row) > 0)
    .sort((left, right) => value(right) - value(left) || codeUnitOrder(left.file, right.file))
    .slice(0, NAMED_FILES);
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}
