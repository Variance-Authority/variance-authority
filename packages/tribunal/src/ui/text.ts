/**
 * The words the surface says, apart from the components that arrange them.
 *
 * A review page is read by a person deciding whether to merge, and the report it
 * draws from is written for a machine. Everything here is that translation, and
 * it is kept in one file because the two halves of the surface — the docket in
 * [`review.tsx`](./review.tsx) and the viewer in [`viewer.tsx`](./viewer.tsx) —
 * would otherwise each grow their own.
 *
 * Nothing here decides anything. A phrase that changed what a reviewer concludes
 * would belong to the store, not to the presentation.
 */

/** `1 pixel` / `8,818 pixels`, so a count of one does not read as a template. */
export function count(value: number, noun: string, plural?: string): string {
  return `${number(value)} ${value === 1 ? noun : (plural ?? `${noun}s`)}`;
}

/** Grouped, because six digits of pixels is a number nobody reads as a quantity. */
export function number(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * A finding's headline, in the words a reviewer thinks in.
 *
 * `FindingRecord` carries a rule id and a sentence, and the sentence is written
 * to follow a noun the report never prints — which is how `label-mismatch reads
 * "SNKR. shop" and is named …` reaches a page. The id is the stable half and is
 * what an ignore list names, so it is kept and shown last; this is the half a
 * person reads first.
 *
 * Unknown rules are humanised rather than dropped. A rule this table has not
 * heard of is a newer report, and printing the slug is a worse page than
 * printing nothing is a wrong one.
 */
export function headline(rule: string): string {
  return TITLES[rule] ?? `${rule.slice(0, 1).toUpperCase()}${rule.slice(1).replace(/-/g, ' ')}`;
}

const TITLES: Readonly<Record<string, string>> = {
  'control-without-name': 'Nothing announces this control',
  'image-without-alt': 'An image with nothing to read',
  'heading-level-skipped': 'The heading outline skips a level',
  'nested-interactive': 'A control inside another control',
  'dangling-reference': 'A reference that points at nothing',
  'label-mismatch': 'The name and the visible words disagree',
  'duplicate-landmark': 'Two landmarks nothing tells apart',
  'table-without-headers': 'A table with no header cells',
  'positive-tabindex': 'Focus order forced out of document order',
  untranslated: 'The same string in two locales',
  'overflows-container': 'A box outside the box that contains it',
};

/**
 * The element itself, out of the landmark phrase that leads to it.
 *
 * `where` is spoken outside-in — `navigation → link "SNKR.shop"` — because the
 * path is how a person finds the thing on screen. The last hop is *what* it is,
 * and it is the noun the finding's sentence was written to follow.
 */
export function element(where: string | undefined): string | undefined {
  return where?.split('→').at(-1)?.trim();
}

/** A clause the report wrote to continue a noun, given back its capital and stop. */
export function sentence(what: string): string {
  const trimmed = what.trim();
  const stopped = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return `${stopped.slice(0, 1).toUpperCase()}${stopped.slice(1)}`;
}

/**
 * A timestamp a person reads, in the zone the record was written in.
 *
 * `2026-08-29T07:34:47.404Z` is a sortable key, and a review page that prints one
 * is showing its storage. UTC is kept and named rather than converted to the
 * reader's zone: a build is compared against other builds, and two rows in the
 * same list must be readable against each other by whoever opens them.
 *
 * The string back unchanged if it is not a timestamp — the field is whatever the
 * writer put there, and a surface that silently prints `Invalid Date` has lost
 * the only copy.
 */
export function when(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;

  const day = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  return `${day}, ${time} UTC`;
}

/**
 * A backticked sentence split into what is prose and what is not.
 *
 * The report writes subject names and fingerprints in backticks, which is the
 * right thing for a file somebody reads in a terminal and the wrong thing here:
 * rendered as text, the marks survive into the page and a reviewer reads
 * ``story:product-card--sale`` with the quotes still on. Splitting rather than
 * stripping, because the mark is carrying a real distinction — that run of
 * characters is an identifier the reader may have to match against something
 * else, and it should be set as one.
 *
 * An unclosed backtick keeps its mark and stays prose. The alternative is to
 * treat the rest of the sentence as an identifier on the strength of one
 * character.
 */
export function segments(text: string): readonly { readonly text: string; readonly code: boolean }[] {
  const parts = text.split('`');
  if (parts.length % 2 === 0) return [{ text, code: false }];

  return parts
    .map((part, index) => ({ text: part, code: index % 2 === 1 }))
    .filter((part) => part.text !== '');
}

/**
 * The size of a change, in the terms it is actually reviewed in.
 *
 * `3,885 pixels differ` is the number every tool in this category leads with, and
 * it is the least useful one available. It answers *how much of the raster is a
 * different colour*, which nobody is deciding anything about, and it degrades in
 * exactly the wrong direction: the bigger the edit, the more the total collapses
 * toward one meaningless figure. A restyle that moved a button in nine places and
 * a page that shifted down two pixels can print the same number.
 *
 * So the count leads with what a reviewer is counting:
 *
 * 1. **Changes** — distinct fingerprints, the shape of the difference with
 *    position and values removed. Two regions with one shape are one thing
 *    happening twice. This is the number of decisions in front of the reviewer.
 * 2. **Regions** — where it happened. Distinct from the above precisely when an
 *    edit lands in many places, which is when the distinction earns its keep.
 * 3. **Pixels** — kept, last, and per region, because the areas are the ranking.
 *
 * The total is printed only when the listed regions do not already carry it.
 * Given three regions of 2,140, 900 and 420 there is no version of `3,460 in all`
 * that tells a reader anything the line above did not.
 */
export interface Magnitude {
  /** Distinct fingerprints; absent when no region carried one. */
  readonly changes?: number;
  readonly regions: number;
  /** Regions the run localised but recorded no shape for. */
  readonly unshaped: number;
  /** Per-region areas, largest first. */
  readonly areas: readonly number[];
  readonly total: number;
}

export function magnitudeOf(subject: {
  readonly changedPixels: number;
  readonly regions: readonly { readonly pixels?: number; readonly fingerprint?: string }[];
}): Magnitude {
  const shapes = new Set(
    subject.regions
      .map((region) => region.fingerprint)
      .filter((shape): shape is string => shape !== undefined),
  );

  return {
    ...(shapes.size === 0 ? {} : { changes: shapes.size }),
    regions: subject.regions.length,
    unshaped: subject.regions.filter((region) => region.fingerprint === undefined).length,
    areas: subject.regions
      .map((region) => region.pixels ?? 0)
      .sort((left, right) => right - left),
    total: subject.changedPixels,
  };
}

/** How many areas are named before the rest become a count. */
const NAMED = 3;

/** The long form, for a surface with a line to spend on it. */
export function magnitude(subject: {
  readonly changedPixels: number;
  readonly regions: readonly { readonly pixels?: number; readonly fingerprint?: string }[];
}): string {
  const size = magnitudeOf(subject);

  // Nothing localised the difference, so the total is all there is to say — and
  // saying it plainly is better than dressing up a number the run did not break
  // down. The absence is the finding, and it belongs to whoever wrote the run.
  if (size.regions === 0) return `${count(size.total, 'pixel')} differ, in regions this run did not record`;

  const where =
    size.changes === undefined
      ? count(size.regions, 'region')
      : `${count(size.changes, 'change')} over ${count(size.regions, 'region')}`;

  const named = size.areas.slice(0, NAMED);
  const rest = size.areas.length - named.length;
  const areas = `${named.map(number).join(', ')} ${named[0] === 1 && named.length === 1 ? 'pixel' : 'pixels'}${
    rest === 0 ? '' : ` and ${number(rest)} smaller`
  }`;

  const carried = named.reduce((sum, area) => sum + area, 0);
  const all = rest === 0 && carried === size.total ? '' : ` · ${number(size.total)} in all`;

  const partial =
    size.changes === undefined || size.unshaped === 0
      ? ''
      : ` · ${count(size.unshaped, 'region')} the run recorded no shape for`;

  return `${where}: ${areas}${all}${partial}`;
}

/** The short form, for a rail item that has to stay one line. */
export function briefly(subject: {
  readonly changedPixels: number;
  readonly regions: readonly { readonly pixels?: number; readonly fingerprint?: string }[];
}): string {
  const size = magnitudeOf(subject);
  if (size.regions === 0) return count(size.total, 'pixel');

  return size.changes === undefined
    ? `${count(size.regions, 'region')} · ${number(size.total)}px`
    : `${count(size.changes, 'change')} · ${count(size.regions, 'region')} · ${number(size.total)}px`;
}
