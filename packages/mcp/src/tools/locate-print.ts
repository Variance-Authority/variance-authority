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
    sections.push(shown.map((hit) => renderHit(hit, places.get(hit.subject))).join('\n'));
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
  const tail = located.dropped.length === 0 ? '.' : `; ${list(located.dropped)} not indexed.`;
  const first =
    asked === 0
      ? `Nothing left of \`${query}\` after the stoplist dropped ${list(located.dropped)}.`
      : count === 0
        ? `No subject of ${located.indexed} matches \`${query}\`.`
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
        ? '\nThis run indexed subject ids and nothing else — it carries no lexicon, which a ' +
          'raster-only or ephemeral run does not write — so a miss below is not a miss on ' +
          'text, names, components or regions; none was searched.'
        : `\n${located.idOnly} subject(s) are indexed by id alone: the run composed nothing for them.`;

  return `${first}${scope}\n${read}${unread}${idOnly}`;
}

function renderHit(hit: LocateHit, place: string | undefined): string {
  const byTerm = new Map<string, LocateMatch[]>();
  for (const match of hit.matches) {
    let list = byTerm.get(match.term);
    if (list === undefined) byTerm.set(match.term, (list = []));
    list.push(match);
  }

  const head =
    `${hit.subject} · ${hit.boundaries} boundar${hit.boundaries === 1 ? 'y' : 'ies'}` +
    (hit.example.length === 0 ? '' : ` · example of ${hit.example.join(', ')}`);

  return [
    head,
    ...(place === undefined ? [] : [`  where: ${place}`]),
    ...[...byTerm].map(
      ([term, matches]) =>
        `  ${term}: ` +
        matches
          .map((match) => `${match.field} ${preview(match.values.map((value) => `\`${value}\``), MAX_VALUES_SHOWN)}`)
          .join('; '),
    ),
  ].join('\n');
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

function list(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(', ');
}

function preview(values: readonly string[], limit: number, separator = ', '): string {
  const shown = values.slice(0, limit).join(separator);
  return values.length > limit ? `${shown}${separator}+${values.length - limit}` : shown;
}
