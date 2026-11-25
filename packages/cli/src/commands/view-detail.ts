// compass: variance-authority.reach
/**
 * The detail view: one pane per test file the page holds, opened by a link from
 * a Tests row or a Timeline lane and never by a tab.
 *
 * A pane carries what the other views know about the file and nothing new: its
 * time, each attempt of its retried cases, its phases and place on the clock,
 * and the source files its cases entered, each a link to that file in Coverage.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { section, text } from './report-html-elements.js';
import type { ViewData } from './view-data.js';
import { fileLink, ms } from './view-tests.js';
import type { View } from './view-shell.js';

/** A source file as a link to its row in Coverage. */
export function sourceLink(file: string): string {
  return `<a class="go file" href="#coverage/${encodeURIComponent(file)}" title="show who entered it">${text(file)}</a>`;
}

function attemptsOf(data: ViewData, file: string): string {
  const cases = data.tests.retried.filter((one) => one.file === file);
  if (cases.length === 0) return '<p class="note">no case in this file ended differently from one attempt to the next</p>';
  return cases
    .map((one) => {
      const rows = one.attempts
        .map(
          (a) =>
            `<tr><td class="num">${a.attempt}</td><td><span class="mark ${a.ended === 'passed' ? 'ok' : 'warn'}">${text(a.ended)}</span></td>` +
            `<td class="num">${a.duration === undefined ? '<span class="nil">—</span>' : text(ms(a.duration))}</td>` +
            `<td>${a.message === undefined || a.message === '' ? '' : `<div class="msg">${text(a.message.slice(0, 300))}</div>`}${a.frame === undefined ? '' : `<div class="msg">${text(a.frame)}</div>`}</td></tr>`,
        )
        .join('');
      return `<h3>${text(one.name)}</h3><table><thead><tr><th>#</th><th>ended</th><th>time</th><th>said</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join('');
}

function placeOf(data: ViewData, file: string): string {
  const traced = data.timeline.files.find((one) => one.file === file);
  if (traced === undefined) return '<p class="note">this file carries no start offset, so the clock does not place it</p>';
  const phases = traced.phases.map((p) => `<span class="mark">${text(`${p.name} ${ms(p.ms)}`)}</span>`).join('');
  return `<p><a class="go" href="#timeline/${encodeURIComponent(file)}">on the timeline</a> · ${text(ms(traced.cost ?? 0))}</p><div>${phases}</div>`;
}

function reachedBy(data: ViewData, file: string): string {
  const row = data.reach.tests.find((one) => one.file === file);
  if (row === undefined) return `<p class="note">${text(data.reach.note ?? 'no source file in the record was entered by this file')}</p>`;
  const more = row.total > row.reached.length ? `<p class="note">${row.total - row.reached.length} more not listed</p>` : '';
  return `<ul class="reach">${row.reached.map((one) => `<li>${sourceLink(one)}</li>`).join('')}</ul>${more}`;
}

/** The test files the page holds anything about. */
function filesOf(data: ViewData): string[] {
  return [
    ...new Set([
      ...data.tests.slowestFiles.map((r) => r.file),
      ...data.tests.slowestCases.map((r) => r.file),
      ...data.tests.retried.map((r) => r.file),
      ...data.timeline.files.map((r) => r.file),
      ...data.reach.tests.map((r) => r.file),
    ]),
  ].sort(codeUnitOrder);
}

/** The detail view: a pane per test file, shown only when the address names it. */
export function detailView(data: ViewData): View {
  const panes = filesOf(data).map((file) => {
    const timed = data.tests.slowestFiles.find((r) => r.file === file);
    const body = section('Attempts', 'every attempt of a case whose attempts ended differently', attemptsOf(data, file)) +
      section('Phases and place', 'where the file ran on the runner\'s clock', placeOf(data, file)) +
      section('Source files reached', 'the files its cases entered, from the covering relation', reachedBy(data, file));
    return (
      `<article class="pane" data-key="${text(file)}"><h2>${text(file)}${timed === undefined ? '' : `<span class="more">${text(ms(timed.duration))}</span>`}</h2>` +
      `${body}<p>${fileLink(file, 'tests')}</p></article>`
    );
  });
  return { id: 'test', label: 'Test', tab: false, pick: true, body: panes.join('') || '<p class="note">no test file recorded</p>' };
}
