import type { CliObservationRecord } from './run-report.js';
import type { CauseEntry } from './docket.js';

/**
 * The pieces every section of the page is built from.
 *
 * Here rather than beside any one section because each of them has several
 * callers, and a helper that lives with its first caller is a helper the second
 * caller reimplements slightly differently. `markers` in particular is rendered
 * twice for the same subject — once in the rail and once on the card — and the
 * two must agree, which is a property a single function has for free.
 */

export function section(name: string, hint: string, body: string): string {
  return (
    `<section id="${text(slug(name))}"><h2>${text(name)}<span class="hint">${text(hint)}</span></h2>${body}</section>`
  );
}

export function chip(label: string, value: string, full?: string): string {
  return (
    `<span class="chip"${full === undefined ? '' : ` title="${text(full)}"`}>` +
    `<b>${text(label)}</b>${text(value)}</span>`
  );
}

/** A value worth taking away from the page, with the taking made one click. */

export function copy(value: string, cut?: number): string {
  const shown = cut !== undefined && value.length > cut ? `${value.slice(0, cut)}…` : value;
  return (
    `<button type="button" class="copy" data-copy="${text(value)}" title="${text(value)}">` +
    `<code>${text(shown)}</code></button>`
  );
}

export function cmd(value: string, label?: string): string {
  return (
    `<button type="button" class="cmd" data-copy="${text(value)}" title="${text(value)}">` +
    (label === undefined ? '' : `<span class="lbl">${text(label)}</span>`) +
    `<code>${text(value.split('\n')[0] ?? value)}${value.includes('\n') ? ' …' : ''}</code></button>`
  );
}

/** Tabular numerals do the aligning; a thousands separator does the reading. */

export function px(n: number): string {
  return `${n.toLocaleString('en-US')}<em>px</em>`;
}

/** Stable, collision-free enough for a fragment, and never leaves the page. */

export function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Every interpolation goes through this, including values this repository wrote.
 *
 * A subject id, a component name and a `where` phrase all come from the page
 * under test, which is to say from somebody else's HTML. Escaping only the fields
 * that look risky is how the one that did not look risky ends up executing — and
 * this page now carries a script, so an unescaped attribute is an execution
 * context rather than a broken layout.
 */

export function text(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}



/**
 * The one qualification the causes list may not drop.
 *
 * `namedIn` is the difference between "this is the edit" and "this is the largest
 * thing that moved", and printing the second in the voice of the first is the
 * confident wrong attribution this repository refuses everywhere else. It is a
 * two-word marker rather than a clause: the reviewer who needs the long version
 * hovers it, and the one who has read it forty times sees a shape.
 */
export function qualifier(entry: CauseEntry): string {
  if (entry.namedIn === 0) {
    return '<span class="mark area" title="No component was named a cause here. Ranked by area, which gets the ordering wrong as often as not.">by area</span>';
  }
  if (entry.namedIn < entry.subjects.length) {
    return (
      `<span class="mark part" title="Named a cause in ${entry.namedIn} of ${entry.subjects.length} subjects; the rest were ranked by area.">` +
      `named ${entry.namedIn}/${entry.subjects.length}</span>`
    );
  }
  return '';
}


/**
 * What a run knows about a subject beyond its pixels, as glyphs.
 *
 * Each of these is a different reason to distrust the comparison, and each has a
 * command behind it in the subject card. They are markers because a reviewer
 * scanning forty rows is looking for the two that are unusual.
 */
export function markers(entry: CliObservationRecord): string {
  const out: string[] = [];
  if (entry.unstable !== undefined) {
    out.push(
      `<span class="mark warn" title="${text(entry.unstable.because)}">read twice ≠</span>`,
    );
  }
  if (entry.alone !== undefined && !entry.alone.reproduced) {
    out.push(`<span class="mark warn" title="${text(entry.alone.because)}">session</span>`);
  }
  if (entry.ignored !== undefined && entry.ignored.pixels > 0) {
    out.push(
      `<span class="mark quiet" title="${entry.ignored.pixels} pixels absorbed by ${entry.ignored.boxes} ignore box(es)">masked</span>`,
    );
  }
  if (entry.diagnostics !== undefined && entry.diagnostics.length > 0) {
    out.push(
      `<span class="mark warn" title="${text(entry.diagnostics.join('\n'))}">${entry.diagnostics.length} diag</span>`,
    );
  }
  return out.join('');
}

