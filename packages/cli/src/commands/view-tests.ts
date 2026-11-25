// compass: variance-authority.reach
/**
 * The Tests view: the slowest files and cases and the cases that were retried,
 * with every attempt and the message it ended on.
 *
 * Arranged from {@link TestsData} and nothing else. A file is a link to its bar
 * in the Timeline; a case that needs a number says it in the unit the runner
 * reported it.
 */

import { durationText } from '@variance-authority/core/shard';
import { section, text } from './report-html-elements.js';
import type { TestsData } from './view-data.js';
import type { View } from './view-shell.js';

const MESSAGE = 300;

/** Milliseconds as the shard lines print them. */
export const ms = durationText;

function table(head: readonly (readonly [name: string, numeric: boolean])[], rows: readonly string[]): string {
  const ths = head.map(([name, numeric]) => `<th data-sort${numeric ? ' class="num"' : ''}>${text(name)}</th>`).join('');
  return `<table><thead><tr>${ths}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** A test file as a link to its row in another view: the Timeline by default. */
export function fileLink(file: string, view: 'timeline' | 'tests' | 'test' = 'test'): string {
  const where = view === 'timeline' ? 'it on the timeline' : view === 'test' ? 'its attempts, phases and the files it entered' : 'its tests';
  return `<a class="go file" href="#${view}/${encodeURIComponent(file)}" title="show ${where}">${text(file)}</a>`;
}

function files(data: TestsData): string {
  if (data.slowestFiles.length === 0) return '';
  const rows = data.slowestFiles.map(
    ({ file, duration }) =>
      `<tr data-key="${text(file)}"><td>${fileLink(file)}</td><td class="num" data-v="${duration}">${text(ms(duration))}</td></tr>`,
  );
  return section('Slowest files', `${data.slowestFiles.length} by what running the file cost`, table([['file', false], ['time', true]], rows)).replace(
    '<section',
    '<section class="part"',
  );
}

function cases(data: TestsData): string {
  if (data.slowestCases.length === 0) return '';
  const rows = data.slowestCases.map(({ file, name, duration, limit }) => {
    const share = limit === undefined || limit === 0 ? undefined : duration / limit;
    return (
      `<tr data-key="${text(`${file} ${name}`)}"><td>${text(name)}</td><td>${fileLink(file)}</td>` +
      `<td class="num" data-v="${duration}">${text(ms(duration))}</td>` +
      `<td class="num" data-v="${limit ?? -1}">${limit === undefined ? '<span class="nil">—</span>' : text(ms(limit))}</td>` +
      `<td class="num" data-v="${share ?? -1}">${share === undefined ? '<span class="nil">—</span>' : `${Math.round(share * 100)}%`}</td></tr>`
    );
  });
  const head = [['case', false], ['file', false], ['time', true], ['limit', true], ['of limit', true]] as const;
  return section('Slowest cases', `${data.slowestCases.length} by what the runner reported`, table(head, rows)).replace('<section', '<section class="part"');
}

function attempts(data: TestsData): string {
  if (data.retried.length === 0) return '';
  const rows = data.retried.map(({ file, name, attempts: tries }) => {
    const marks = tries
      .map((one) => `<span class="mark ${one.ended === 'passed' ? 'ok' : 'warn'}" title="${text(`attempt ${one.attempt}: ${one.duration === undefined ? "no time" : ms(one.duration)}`)}">${text(`${one.attempt} ${one.ended}`)}</span>`)
      .join('');
    const said = tries.flatMap((one) => (one.message === undefined || one.message === '' ? [] : [`${one.attempt}: ${one.message}`]));
    const message = said.length === 0 ? '' : `<div class="msg">${text(said.at(-1)!.slice(0, MESSAGE))}</div>`;
    return `<tr data-key="${text(`${file} ${name}`)}"><td>${text(name)}${message}</td><td>${fileLink(file)}</td><td>${marks}</td><td class="num" data-v="${tries.length}">${tries.length}</td></tr>`;
  });
  const hint = `${data.differing} ended differently from one attempt to the next`;
  return section('Retried cases', hint, table([['case', false], ['file', false], ['attempts', false], ['n', true]], rows)).replace(
    '<section',
    '<section class="part"',
  );
}

/** The Tests view, with the reason beside every half the recording could not fill. */
export function testsView(data: TestsData): View {
  const notes = data.notes.map((note) => `<p class="note">${text(note)}</p>`).join('');
  return { id: 'tests', label: 'Tests', body: notes + files(data) + cases(data) + attempts(data) };
}

/** What only this view draws. */
export const TESTS_STYLE = `
.msg{font-family:var(--mono);font-size:10.5px;color:var(--quiet);margin-top:.2rem;max-width:42rem;overflow-wrap:anywhere}
`;
