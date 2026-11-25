// compass: variance-authority.reach
/**
 * The source view: one pane per source file the page holds the text of, opened
 * by a link from the Coverage tab's entered files and never by a tab.
 *
 * Each line is drawn in the state of the range over it; where ranges nest, the
 * narrowest one decides. The state names are `covering`'s, and the page adds
 * only a colour to each.
 */

import { section, text } from './report-html-elements.js';
import type { SourceMark, SourceRow, SourcesData } from './view-source.js';
import type { View } from './view-shell.js';

/** One colour for each state the CLI names; the name is also on the line, so colour is never the only signal. */
export const SOURCE_STYLE = `
pre.src{margin:0;overflow-x:auto;font:12px/1.55 var(--mono)}
pre.src .ln{display:block;padding-left:.6rem;border-left:3px solid transparent;white-space:pre}
pre.src .ln[data-state=walked]{border-left-color:#3fb950;background:#3fb95012}
pre.src .ln[data-state=alone]{border-left-color:#d29922;background:#d2992212}
pre.src .ln[data-state=loaded]{border-left-color:#58a6ff;background:#58a6ff12}
pre.src .ln[data-state=hole]{border-left-color:#bc8cff;background:#bc8cff12}
pre.src .ln[data-state=unwalked]{border-left-color:#f85149;background:#f8514918}
`;

/** The state of each line, the narrowest range over it winning. */
function stateAt(lines: number, marks: readonly SourceMark[]): (string | undefined)[] {
  const states = Array.from<string | undefined>({ length: lines });
  for (const mark of [...marks].sort((a, b) => b.endLine - b.startLine - (a.endLine - a.startLine))) {
    for (let line = Math.max(1, mark.startLine); line <= Math.min(lines, mark.endLine); line++) states[line - 1] = mark.state;
  }
  return states;
}

function legend(marks: readonly SourceMark[]): string {
  const states = [...new Set(marks.map((mark) => mark.state))].sort();
  return states.length === 0 ? '' : `<p>${states.map((state) => `<span class="mark">${text(state)}</span>`).join('')}</p>`;
}

function paneOf(row: SourceRow): string {
  const note = row.note === undefined ? '' : `<p class="note">${text(row.note)}</p>`;
  let drawn = '';
  if (row.text !== undefined) {
    const lines = row.text.replace(/\n$/u, '').split('\n');
    const states = stateAt(lines.length, row.marks);
    const body = lines
      .map((line, at) => (states[at] === undefined ? `<span class="ln">${text(line)}</span>` : `<span class="ln ${states[at]}" data-state="${states[at]}">${text(line)}</span>`))
      .join('');
    drawn = `${legend(row.marks)}<pre class="src">${body}</pre>`;
  }
  return `<article class="pane" data-key="${text(row.file)}"><h2>${text(row.file)}</h2>${section('Source', 'each line in the state of the range over it', note + drawn)}</article>`;
}

/** The source view: a pane per file, shown only when the address names it. */
export function sourceView(sources: SourcesData): View {
  const more = sources.left > 0 ? `<p class="note">${sources.left} more source files are not drawn: the page holds the text of the ${sources.files.length} most-entered</p>` : '';
  return { id: 'source', label: 'Source', tab: false, pick: true, body: sources.files.map(paneOf).join('') + more };
}
