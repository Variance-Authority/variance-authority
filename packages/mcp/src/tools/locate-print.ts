import type { LexiconField, RunReport } from '@variance-authority/report';
import { placesOn } from './place.js';
import { scopeLine } from './scope.js';
import type { Located, LocateHit, LocateMatch } from './locate.js';

/**
 * A ranking, printed.
 *
 * Apart from the search because the two halves answer to different people. What
 * a hit *is* — which field matched a term, how rare that word was in it — is
 * decided by the suite and is the same fact however it is shown. How much of it
 * fits in front of a reader, which three values are named and which are only
 * counted, which sentence a nil answer gets, is decided by the reader and moves
 * whenever they are given something they cannot use. Nothing here computes a
 * rank, and nothing in [`locate.ts`](./locate.ts) formats one.
 */
/** Why a field is absent from a report, said per field. */
const WHY_UNREAD: Readonly<Record<LexiconField, string>> = {
  example: 'no composition',
  names: 'no semantic snapshot',
  text: 'no semantic snapshot',
  components: 'no boundaries',
  createdBy: 'no boundaries',
  regions: 'no execution journal was read',
  files: 'no source index and no provenance',
  roles: 'no semantic snapshot',
  tokens: 'no boundaries',
};

const MAX_VALUES_SHOWN = 3;
const MAX_NAMES_SHOWN = 24;

/** The whole answer, in the order a reader meets it: the count, the scope, the hits, what to ask next. */
export function render(report: RunReport, located: Located, query: string, limit: number): string {
  const sections: string[] = [headline(located, query)];

  if (located.hits.length > 0) {
    const shown = located.hits.slice(0, limit);
    // Only the rows about to be printed are read for a place. The rest were
    // ranked on their names and are counted, not shown, so reading their
    // arrangement would be work nobody sees.
    const places = placesOn(report, shown.map((hit) => hit.subject), query);
    sections.push(shown.map((hit) => renderHit(hit, places.get(hit.subject), located.searched)).join('\n'));
    const rest = located.hits.slice(limit);
    if (rest.length > 0) {
      sections.push(`…and ${rest.length} more: ${preview(rest.map((hit) => hit.subject), 6)}`);
    }
  }

  if (located.unmatched.length > 0) sections.push(unmatchedSection(located));

  const top = located.hits[0];
  if (top !== undefined) {
    sections.push(
      `next: variance_composition {subject: "${top.subject}"} · variance_describe {subject: "${top.subject}"}`,
    );
  }

  return sections.join('\n\n');
}

function headline(located: Located, query: string): string {
  const count = located.hits.length;
  const asked = located.terms.length;
  const best = located.cover;
  const found = asked - located.unmatched.length;
  const tail = located.dropped.length === 0 ? '.' : `; ${list(located.dropped)} not indexed.`;
  const first =
    asked === 0
      ? `Nothing left of \`${query}\` after the stoplist dropped ${list(located.dropped)}.`
      : count === 0
        ? `No subject of ${located.indexed} matches \`${query}\`.`
        : !located.distinguished
          ? // Abstaining is the answer. Every word that was found is said by
            // most of what was searched wherever it was said, and so is every
            // pair, so the holders are printed and their order is said to be no
            // answer. A word held nowhere picks nothing out either, and is named.
            `None of the ${found} term${found === 1 ? '' : 's'} of \`${query}\`` +
            `${located.unmatched.length === 0 ? '' : ' found'} distinguishes a subject: ` +
            `${found === 1 ? 'it is' : 'each is'} in more than half the ${located.searched} subjects ` +
            `searched, in every field it matched` +
            `${located.hits.some((hit) => hit.together.length > 0) ? ', and so is every pair of them said side by side' : ''}` +
            `${located.unmatched.length === 0 ? '' : `, and ${list(located.unmatched)} ${located.unmatched.length === 1 ? 'is' : 'are'} held by none`}. ` +
            `The ${count} subject(s) with ` +
            `${found === 1 ? 'it' : 'them'} are listed; their order is no answer${tail}`
          : best < asked
          ? // Partial cover is the answer a large suite gives to a question it
            // cannot take. Saying *n subjects match* would be false: they match
            // a word of it. On fifteen subjects there was nothing to half-match
            // and the distinction never showed; on five thousand a question
            // about something the suite does not have still draws hundreds.
            `No subject of ${located.indexed} matches all ${asked} terms of \`${query}\`. ` +
            `The best cover is ${best} of ${asked}, over ${count} subject(s)${tail}`
          : `${count} of ${located.indexed} subject(s) match \`${query}\`${tail}`;

  const scope = located.scope === undefined ? '' : `\n${scopeLine(located.scope, located.indexed)}`;
  const read = `Read: ${located.read.join(', ')}.`;
  const unread =
    located.unread.length === 0
      ? ''
      : ` Not read: ${located.unread.map((field) => `${field} (${WHY_UNREAD[field]})`).join(', ')}.`;

  const idOnly =
    located.idOnly === 0
      ? ''
      : located.idOnly === located.indexed
        ? '\nThis run indexed subject ids and nothing else. It read no markup — a raster-only ' +
          'capture, or a run whose collector gave only images — so it has no lexicon, and a ' +
          'miss below is not a miss on text, names, components or regions; none was searched.'
        : `\n${located.idOnly} subject(s) are indexed by id alone: the run composed nothing for them.`;

  return `${first}${commonLine(located)}${scope}\n${read}${unread}${idOnly}`;
}

/**
 * The words in most of the searched subjects, by the fields they are in. Said
 * beside the count because it changes what the count means: a subject with the
 * role `button` in a suite of buttons was matched by a word that says nothing
 * about it.
 */
function commonLine(located: Located): string {
  const fieldsOf = new Map<string, Set<string>>();
  for (const hit of located.hits) {
    for (const match of hit.matches) {
      if (!match.common) continue;
      let fields = fieldsOf.get(match.term);
      if (fields === undefined) fieldsOf.set(match.term, (fields = new Set()));
      fields.add(match.field);
    }
  }
  const byFields = new Map<string, string[]>();
  for (const term of located.terms) {
    const fields = fieldsOf.get(term);
    if (fields === undefined) continue;
    const key = conjoined([...fields]);
    let terms = byFields.get(key);
    if (terms === undefined) byFields.set(key, (terms = []));
    terms.push(term);
  }
  return [...byFields]
    .map(
      ([fields, terms]) =>
        `\n${list(terms)} ${terms.length === 1 ? 'is' : 'are'} in the ${fields} of more than half ` +
        `the ${located.searched} subjects searched, and there ${terms.length === 1 ? 'it distinguishes' : 'they distinguish'} ` +
        'none of them.',
    )
    .join('');
}

function renderHit(hit: LocateHit, place: string | undefined, searched: number): string {
  const byTerm = new Map<string, LocateMatch[]>();
  for (const match of hit.matches) {
    let list = byTerm.get(match.term);
    if (list === undefined) byTerm.set(match.term, (list = []));
    list.push(match);
  }
  const byPair = new Map<string, LocateMatch[]>();
  for (const match of hit.together) {
    let list = byPair.get(match.term);
    if (list === undefined) byPair.set(match.term, (list = []));
    list.push(match);
  }

  const head =
    `${hit.subject} · ${hit.boundaries} boundar${hit.boundaries === 1 ? 'y' : 'ies'}` +
    (hit.example.length === 0 ? '' : ` · example of ${hit.example.join(', ')}`);

  return [
    head,
    ...(place === undefined ? [] : [`  where: ${place}`]),
    ...[...byTerm].map(([term, matches]) => `  ${term}: ${fieldsLine(matches, searched)}`),
    ...[...byPair].map(([pair, matches]) => `  \`${pair}\` side by side: ${fieldsLine(matches, searched)}`),
  ].join('\n');
}

function fieldsLine(matches: readonly LocateMatch[], searched: number): string {
  return matches
    .map(
      (match) =>
        `${match.field} ${preview(match.values.map((value) => `\`${value}\``), MAX_VALUES_SHOWN)}` +
        (match.common ? ` (in ${match.holders} of ${searched})` : ''),
    )
    .join('; ');
}

function unmatchedSection(located: Located): string {
  const words = list(located.unmatched);
  const verb = located.unmatched.length === 1 ? 'occurs' : 'occur';
  if (located.names.length === 0) {
    return `${words} ${verb} in no field that was read. This run recorded no accessible names to offer instead.`;
  }
  return (
    `${words} ${verb} in no field that was read. The names this run did record:\n  ` +
    preview(located.names, MAX_NAMES_SHOWN, ' · ')
  );
}

/** `a`, `a and b`, `a, b and c`. */
export function conjoined(values: readonly string[]): string {
  return values.length < 2 ? (values[0] ?? '') : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}

function list(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(', ');
}

function preview(values: readonly string[], limit: number, separator = ', '): string {
  const shown = values.slice(0, limit).join(separator);
  return values.length > limit ? `${shown}${separator}+${values.length - limit}` : shown;
}
