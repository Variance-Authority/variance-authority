import type { Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Entry, Help } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';
import { specifierOf } from './find.js';
import { line } from './format.js';

/**
 * `docs_search` — the name for a thing somebody can only describe.
 *
 * Substring, case-insensitive, over the name and over what was written about it.
 * Not fuzzy and not embedded: a match here is a fact about the text, so a caller
 * that gets nothing back has learned something true rather than that the ranking
 * disagreed with them. `docs_entrypoint` is the move after an empty answer, and
 * it is a cheap one.
 */

const CAP = 40;

function matches(entry: Entry, query: string): boolean {
  return entry.name.toLowerCase().includes(query) || (entry.doc ?? '').toLowerCase().includes(query);
}

export const search: Tool<Help> = {
  name: 'docs_search',
  description:
    'Find published names whose name or documentation contains a string, case-insensitive, ' +
    'ordered by how many packages import them. Each result carries the import specifier it is ' +
    'published from, so it can be passed straight to docs_symbol.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Substring to look for in names and docs.' } },
    required: ['query'],
    additionalProperties: false,
  },

  run(help, input) {
    const query = stringArg(input, 'query').toLowerCase();

    const found = [...everyEntry(help)]
      .filter(([, , entry]) => matches(entry, query))
      .sort(
        ([, , a], [, , b]) =>
          b.usedBy.length - a.usedBy.length ||
          b.uses - a.uses ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      );

    if (found.length === 0) {
      return `Nothing published contains \`${query}\`. docs_packages lists every entrypoint; docs_entrypoint lists what one opens.`;
    }

    const shown = found.slice(0, CAP);
    // A capped list that does not say it was capped reads as the whole answer,
    // and the reader's next move — narrow, or ask the entrypoint — depends on
    // knowing which of the two it got.
    const more = found.length > shown.length ? [`\n${found.length - shown.length} more matches not shown.`] : [];

    return [
      `${found.length} matches for \`${query}\``,
      '',
      ...shown.map(([published, held, entry]) => `${specifierOf(published, held)} · ${line(entry)}`),
      ...more,
    ].join('\n');
  },
};
