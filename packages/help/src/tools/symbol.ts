import type { Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { entriesNamed, specifierOf } from './find.js';
import { block } from './format.js';

/**
 * `docs_symbol` — one name, in full.
 *
 * Answered for every specifier that publishes it rather than for the first,
 * because a declaration reachable from a barrel and from a subpath is one thing
 * with two import lines, and picking one of them for the caller would make the
 * line they write depend on which door this reading walked through first.
 */
export const symbol: Tool<Help> = {
  name: 'docs_symbol',
  description:
    'Everything known about one exported name: what it is, the import line that reaches it, the ' +
    'file and line that declares it, its full signature, its documentation — or, where nothing is ' +
    'written above it, the README passage that names it — and which packages import it. Names are ' +
    'matched exactly; use docs_search when the exact name is not known, docs_uses for call sites.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The exported name, matched exactly.' },
      package: { type: 'string', description: 'Only answer from this package. Optional.' },
    },
    required: ['name'],
    additionalProperties: false,
  },

  run(help, input) {
    const name = stringArg(input, 'name');
    const from = input['package'];
    const wanted = typeof from === 'string' && from !== '' ? from : undefined;

    const found = entriesNamed(help, name).filter(([published]) => wanted === undefined || published.name === wanted);

    if (found.length === 0) {
      const where = wanted === undefined ? 'this workspace' : `\`${wanted}\``;
      throw new Error(`\`${name}\` is not published by ${where}; try docs_search for a name like it`);
    }

    const [first] = found;
    if (first === undefined) throw new Error(`\`${name}\` was found and then was not`);

    const doors = found.map(([published, held]) => specifierOf(published, held));
    const also = doors.length > 1 ? [`\nAlso published by: ${doors.slice(1).join(', ')}`] : [];

    // What the name is, and then — once, in one line — that the other half of
    // the question has an answer. Naming the tool rather than printing the sites
    // is the budget: most callers want the signature and stop, and the ones who
    // want the call sites want them ranked against a file this tool never asked
    // for.
    const written = first[2].sites.length;
    const shown =
      written === 0
        ? []
        : [`\ndocs_uses names the ${written} ${written === 1 ? 'place' : 'places'} this is imported, nearest to a file you name first.`];

    return [block(first[0], first[1], first[2]), ...also, ...shown].join('\n');
  },
};
