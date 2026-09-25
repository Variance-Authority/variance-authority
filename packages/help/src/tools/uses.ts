import type { Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Documented, Entry, Help, Opening, Use } from '@variance-authority/package/help';
import { entriesNamed, isPackage, unfound } from './find.js';

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
 * `from` — the file the asker is working in. Not import distance: this question
 * asks where a known name is imported, and its `from` only chooses which exact
 * sites to show first. The graph belongs to `docs_search`, where a start point
 * removes names outside a closure. Shared segments are readable off the two
 * strings. The claim here is the modest one it can support — *this import site
 * is written near the code you are in* — and a caller that passes no
 * `from` is told the sites in path order rather than a made-up ranking.
 *
 * ## A story is pointed at, not quoted
 *
 * A story or a test is a file written to show the thing being used, which is
 * what an example is, and both are named here with a line to open. What comes
 * back is the path, not the source. Serving the source would spend a context
 * window re-transmitting a file the caller can read in one cheap operation, and
 * it would answer with the file as it was when this reading was taken.
 *
 * ## A module held whole is named as such
 *
 * A name read off `import()` or off `import * as` is a site like any other, and
 * it is marked, because the line that reads the name is not the line that loads
 * it. An `import()` loads the module when that call runs, so whether the name
 * is there at all can depend on a path the program takes.
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
    ...shown.map((use) => `${use.at}:${use.line} — ${use.by}${use.type ? ' (type only)' : ''}${held(use)}`),
    ...(rest > 0 ? [`… and ${rest} more.`] : []),
  ];
}

/** Where a name read off a module held whole was loaded, and when. */
function held(use: Use): string {
  if (use.through === undefined) return '';
  return use.through.kind === 'dynamic'
    ? ` (import() on line ${use.through.line})`
    : ` (namespace, line ${use.through.line})`;
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
    'Every file:line in the workspace that imports one exported name, including reads through ' +
    '`import()` or `import * as`, marked with the line that loads the module. Stories and tests ' +
    'are listed apart. `from`, the file you are in, sorts sites by shared path.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The exported name, matched exactly.' },
      package: { type: 'string', description: 'Only answer from this package, by name or by specifier. Optional.' },
      from: {
        type: 'string',
        description:
          'The file you are working in, relative to the workspace root. Sites written near it ' +
          'are listed first. This orders the sites and never removes one — every site of the ' +
          'name still comes back. Unlike `from` on docs_search, it is not a start point and no ' +
          'import graph is walked: nearness here is how many leading path segments two files ' +
          'share. Optional.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },

  run(help, input) {
    const name = stringArg(input, 'name');
    const wanted = typeof input['package'] === 'string' && input['package'] !== '' ? input['package'] : undefined;
    const from = typeof input['from'] === 'string' && input['from'] !== '' ? input['from'] : undefined;

    const found = entriesNamed(help, name).filter(
      ([published, held]) => wanted === undefined || isPackage(published, held, wanted),
    );
    if (found.length === 0) throw new Error(unfound(help, name, wanted));

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
        ? 'Path order; `from` sorts nearest first.'
        : `Nearest to ${from} first.`;

    const dynamic = sites.filter((use) => use.through?.kind === 'dynamic').length;
    const loaded = dynamic === 0 ? '.' : `, ${dynamic} through import(), which loads the module when the call runs.`;
    return [
      `\`${name}\` is imported in ${sites.length} ${sites.length === 1 ? 'place' : 'places'}${loaded}`,
      nearest,
      ...listed(stories, 'Stories:'),
      ...listed(tests, 'Tests:'),
      ...listed(source, 'Source:'),
    ].join('\n');
  },
};
