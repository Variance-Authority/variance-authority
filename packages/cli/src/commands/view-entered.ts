// compass: variance-authority.reach
/**
 * Who entered a source file: the Coverage view's second half, drawn from the
 * covering relation alone, so it holds where no coverage was counted.
 */

import { section, text } from './report-html-elements.js';
import type { ReachData } from './view-data.js';

/** One row per source file, with the test files that entered it, each a link back to its pane. */
export function enteredSection(reach: ReachData): string {
  if (reach.files.length === 0) return `<p class="note">${text(reach.note ?? 'no source file was entered by a recorded test')}</p>`;
  const rows = reach.files.map((row) => {
    const links = row.tests.map((t) => `<a class="go file" href="#test/${encodeURIComponent(t)}">${text(t)}</a>`).join('<br>');
    const more = row.total > row.tests.length ? `<br><span class="nil">${row.total - row.tests.length} more</span>` : '';
    return `<tr data-key="${text(row.file)}"><td>${text(row.file)}</td><td class="num" data-v="${row.total}">${row.total}</td><td>${links}${more}</td></tr>`;
  });
  const head = '<th data-sort>file</th><th data-sort class="num">tests</th><th>entered by</th>';
  return section('Entered files', `${reach.files.length} source files by how many test files entered them`, `<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`, undefined, undefined, 'part');
}
