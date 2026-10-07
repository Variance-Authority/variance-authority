import type { Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { counted, ownerOf, surfaceByPath } from './by-path.js';
import { doorOf, specifierOf } from './find.js';
import { line } from './format.js';

/**
 * `docs_entrypoint` — what one import specifier opens, most-used first.
 *
 * The ordering is the answer. A published surface handed over alphabetically is
 * a thousand equally-weighted facts, and the name somebody needs is as likely to
 * be last as first; ordered by how much of the repository reaches for each name,
 * a reader who stops a third of the way in has read the third that gets used.
 */
export const entrypoint: Tool<Help> = {
  name: 'docs_entrypoint',
  description:
    'Every name one import specifier opens, ordered by how many packages import it, with its ' +
    'kind and the first line of its documentation. Names marked UNDOCUMENTED have nothing ' +
    'written above them — the source is the only thing that says what they do. Use ' +
    'docs_symbol for the full signature and documentation of one name.',
  inputSchema: {
    type: 'object',
    properties: {
      package: {
        type: 'string',
        description:
          'The specifier as docs_packages reports it, e.g. `@scope/name/file`, or the package ' +
          'name alone with the subpath given separately.',
      },
      subpath: {
        type: 'string',
        description: "Entrypoint subpath, e.g. './file'. Defaults to '.', the package's main entrypoint.",
      },
    },
    required: ['package'],
    additionalProperties: false,
  },

  run(help, input) {
    const subpath = input['subpath'];
    const asked = stringArg(input, 'package');
    const unentered = typeof subpath === 'string' && subpath !== '' ? undefined : unenteredAnswer(help, asked);
    if (unentered !== undefined) return unentered;
    const [published, held] = doorOf(help, asked, typeof subpath === 'string' && subpath !== '' ? subpath : undefined);

    if (held.entries.length === 0) return `${specifierOf(published, held)} opens no names.`;

    return [`${specifierOf(published, held)} — ${held.entries.length} names`, '', ...held.entries.map(line)].join(
      '\n',
    );
  },
};

/**
 * A package that declares no entry opens nothing, and what other packages
 * import from it by path is the answer in its place.
 */
function unenteredAnswer(help: Help, asked: string): string | undefined {
  const owner = ownerOf(asked);
  if (!help.byPath.some((held) => ownerOf(held.specifier) === owner)) {
    const published = help.packages.find((candidate) => candidate.name === asked);
    if (published === undefined || published.openings.length > 0) return undefined;
    if (help.deep.some((held) => ownerOf(held.specifier) === owner)) return undefined;
    return `${asked} opens no entry, and no other package imports a file of it.`;
  }
  const surface = surfaceByPath(help, owner, asked === owner ? undefined : asked);
  const { lines } = surface;
  const heading = `${owner} declares no entry: no \`exports\`, \`main\` or \`types\`.`;
  if (lines.length === 0) return `${heading} No other package imports ${asked === owner ? 'a file of it' : asked}.`;
  const count = asked === owner ? counted(surface) : `${lines.length} ${lines.length === 1 ? 'name' : 'names'} from ${asked}`;
  return [`${heading} Other packages import ${count} by path:`, ...lines].join('\n');
}
