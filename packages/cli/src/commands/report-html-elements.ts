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

/**
 * One section, and — when it is about one — the verdicts it speaks about.
 *
 * `holds` exists for the census bar. Every segment of that bar is a filter, and a
 * section that stays open under a filter it holds nothing for is the empty pane a
 * reader reads as *there are none*. Sections whose items carry `data-subject`
 * need no declaration; the script hides those when every item in them is hidden.
 * This is for the ones that hold a derived thing instead — a cluster is about
 * `changed` and has no subject row of its own to be counted.
 */
export function section(
  name: string,
  hint: string,
  body: string,
  holds?: string,
  /** Starts hidden, and is revealed by pressing the census segment it holds. */
  quiet?: boolean,
  /** One more class on the section, such as `part` for a view's own sections. */
  className?: string,
): string {
  return `${opening(name, hint, holds, quiet, className)}${body}</section>`;
}

/** A section's opening tag and heading, for a body written in pieces. */
export function opening(name: string, hint: string, holds?: string, quiet?: boolean, className?: string): string {
  const classes = [...(quiet === true ? ['hidden'] : []), ...(className === undefined ? [] : [className])];
  return (
    `<section id="${text(slug(name))}"` +
    (classes.length === 0 ? '' : ` class="${classes.join(' ')}"`) +
    (holds === undefined ? '' : ` data-holds="${text(holds)}"`) +
    `><h2>${text(name)}<span class="hint">${text(hint)}</span></h2>`
  );
}

/** One part of a census: its class, its size, what its segment says on hover, and its key's markup. */
export interface CensusPart {
  readonly name: string;
  readonly n: number;
  readonly title: string;
  readonly key: string;
}

/**
 * A whole as one bar of parts in proportion, with a key under it for each part.
 * A part that is zero is neither drawn nor keyed. `row` names the keys for a
 * page that addresses its rows.
 */
export function census(parts: readonly CensusPart[], row?: string): string {
  const shown = parts.filter((part) => part.n > 0);
  const bar = shown.map((part) => `<i class="seg ${part.name}" style="flex:${part.n}" title="${text(part.title)}"></i>`).join('');
  const keys = shown.map((part) => part.key).join('');
  return `<div class="census"><div class="bar">${bar}</div><div class="keys"${row === undefined ? '' : ` data-row="${text(row)}"`}>${keys}</div></div>`;
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

