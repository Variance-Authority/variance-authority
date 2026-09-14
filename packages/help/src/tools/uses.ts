import type { Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Documented, Entry, Help, Opening, Use } from '@variance-authority/package/help';
import { entriesNamed } from './find.js';

/**
 * `docs_uses` — how this repository actually writes a name.
 *
 * The second of the two questions somebody has about a symbol, and the one a
 * signature cannot answer. `docs_symbol` says what the thing is supposed to be;
 * this says where it is already being done, which is the answer that survives a
 * doc comment going stale, and the only one that carries the conventions nobody
 * wrote down.
 *
 * ## Nearest, by how much of the path is shared
 *
 * Sites come back ordered by how many leading path segments they share with
 * `from` — the file the asker is working in. Not import distance: that is a
 * graph, [`@variance-authority/sense`](../../../sense) owns it, and it needs an
 * index this server deliberately does not keep. Shared segments are readable off
 * the two strings, which is the whole reason this can re-read the workspace on
 * every request. The claim it makes is the modest one it can support — *this
 * call site is written in the code you are in* — and a caller that passes no
 * `from` is told the sites in path order rather than a made-up ranking.
 *
 * ## A story is pointed at, not quoted
 *
 * A story or a test is a file written to show the thing being used, which is
 * what an example is, and both are named here with a line to open. What comes
 * back is the path, not the source. Serving the source would spend a context
 * window re-transmitting a file the caller can read in one cheap operation, and
 * it would answer with the file as it was when this reading was taken.
 */

/** How many leading path segments two files share. */
export function sharedSegments(left: string, right: string): number {
  const a = left.split('/');
  const b = right.split('/');

  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared;
}

/** How many sites of one kind are worth naming before the list stops being read. */
const CAP = 12;

function order(sites: readonly Use[], from: string | undefined): readonly Use[] {
  return [...sites].sort(
    (a, b) =>
      (from === undefined ? 0 : sharedSegments(from, b.at) - sharedSegments(from, a.at)) ||
      (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) ||
      a.line - b.line,
  );
}

function listed(sites: readonly Use[], heading: string): readonly string[] {
  if (sites.length === 0) return [];

  const shown = sites.slice(0, CAP);
  const rest = sites.length - shown.length;
  return [
    '',
    heading,
    '',
    ...shown.map((use) => `${use.at}:${use.line} — ${use.by}${use.type ? ' (type only)' : ''}`),
    ...(rest > 0 ? [`… and ${rest} more.`] : []),
  ];
}

/** Every site of one name, across every door it is published from, without duplicates. */
function sitesOf(found: readonly (readonly [Documented, Opening, Entry])[]): readonly Use[] {
  const seen = new Set<string>();
  const sites: Use[] = [];

  for (const [, , entry] of found) {
    for (const use of entry.sites) {
      const key = `${use.at}:${use.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sites.push(use);
    }
  }
  return sites;
}

export const uses: Tool<Help> = {
  name: 'docs_uses',
  description:
    'Every place in the workspace that imports one exported name, with the file and line to ' +
    'open. Stories and tests are listed separately as worked examples. Pass `from` — the file ' +
    'you are working in — to order the sites by how much of their path they share with it.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The exported name, matched exactly.' },
      package: { type: 'string', description: 'Only answer from this package. Optional.' },
      from: {
        type: 'string',
        description:
          'The file you are working in, relative to the workspace root. Sites written near it ' +
          'are listed first. Optional.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },

  run(help, input) {
    const name = stringArg(input, 'name');
    const wanted = typeof input['package'] === 'string' && input['package'] !== '' ? input['package'] : undefined;
    const from = typeof input['from'] === 'string' && input['from'] !== '' ? input['from'] : undefined;

    const found = entriesNamed(help, name).filter(([published]) => wanted === undefined || published.name === wanted);
    if (found.length === 0) {
      const where = wanted === undefined ? 'this workspace' : `\`${wanted}\``;
      throw new Error(`\`${name}\` is not published by ${where}; try docs_search for a name like it`);
    }

    const sites = sitesOf(found);
    if (sites.length === 0) {
      return `\`${name}\` is published and nothing in this workspace imports it. docs_symbol has its signature and what is written above it.`;
    }

    const sorted = order(sites, from);
    const stories = sorted.filter((use) => use.kind === 'story');
    const tests = sorted.filter((use) => use.kind === 'test');
    const source = sorted.filter((use) => use.kind === 'source');

    const nearest =
      from === undefined
        ? 'In path order; pass `from` to put the sites nearest your file first.'
        : `Nearest first, by how much of the path each shares with ${from}.`;

    return [
      `\`${name}\` is imported in ${sites.length} ${sites.length === 1 ? 'place' : 'places'}.`,
      nearest,
      ...listed(stories, 'Stories — written to show it in use:'),
      ...listed(tests, 'Tests — written to pin what it does:'),
      ...listed(source, 'Source:'),
    ].join('\n');
  },
};
