import type { Tool } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { entriesNamed, isPackage, specifierOf, unfound } from './find.js';
import { block } from './format.js';
import { queryDependencyLexicon, type LexiconMatches, type ThirdPartyMatch } from '../dependency-lexicon.js';
import { silentBlocks } from './silent.js';
import { provenance } from './third-party.js';

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
    'matched exactly, including installed third-party declarations when the API catalogue is ' +
    'published, and, given `from`, as the workspace that owns that path resolves them; use docs_search ' +
    'when the exact name is not known, docs_uses for local import sites.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The exported name, matched exactly.' },
      package: { type: 'string', description: 'Only answer from this package, by name or by specifier. Optional.' },
      from: {
        ...START_POINT_SCHEMA.from,
        description:
          'Optional. A path in the source tree. An installed third-party name is answered as the manifest that owns ' +
          'that path resolves it: its version and signature there, whether the code already imports it, and where ' +
          'else it is declared when it is not usable there.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },

  run(help, input, invocation) {
    const name = stringArg(input, 'name');
    const from = input['package'];
    const wanted = typeof from === 'string' && from !== '' ? from : undefined;

    const found = entriesNamed(help, name).filter(
      ([published, held]) => wanted === undefined || isPackage(published, held, wanted),
    );

    if (found.length === 0 && invocation?.root !== undefined) {
      const at = startPointArg(input, 'from');
      const paths = at === undefined ? undefined : typeof at === 'string' ? [at] : [...at];
      const everywhere = queryDependencyLexicon(invocation.root, name, undefined, true, wanted, 100);
      if (everywhere === undefined) throw new Error(`the dependency lexicon is not published; run \`variance index\` before asking about \`${name}\``);
      const here = paths === undefined ? everywhere : queryDependencyLexicon(invocation.root, name, paths, true, wanted, 100);
      const silent = silentBlocks(invocation.root, name, (here ?? everywhere).silent ?? [], wanted !== undefined);
      const described = (entry: ThirdPartyMatch): string =>
        `${entry.specifier} · ${entry.name} [${entry.kind}] · ${entry.package}${entry.version === undefined ? '' : `@${entry.version}`}` +
        `${entry.declarationProvider === undefined ? '' : ` · declarations: ${entry.declarationProvider}`}` +
        `\n${provenance(entry)}\n${entry.at}:${entry.line}${entry.signature === undefined ? '' : `\n${entry.signature}`}${entry.doc === undefined ? '' : `\n${entry.doc}`}`;
      const cut = (matches: LexiconMatches): readonly string[] =>
        matches.total > matches.shown.length ? [`${matches.total - matches.shown.length} more matches not shown.`] : [];
      if (paths !== undefined && here !== undefined && here.total === 0 && everywhere.total > 0) {
        // Not usable at the path is a fact with an answer: the workspaces that do offer it, each with its own version.
        const owner = here.scope.location?.join(', ') ?? 'the manifest that owns it';
        const where = paths.join(', ');
        return [
          `\`${name}\` is not usable from ${where}: ${owner} does not declare or import it. It is offered under:`,
          ...everywhere.shown.map(described),
          ...cut(everywhere),
        ].join('\n\n');
      }
      const shown = here ?? everywhere;
      if (shown.total > 0 || silent.length > 0) return [...silent, ...shown.shown.map(described), ...cut(shown)].join('\n\n');
    }
    if (found.length === 0) throw new Error(unfound(help, name, wanted));

    const [first] = found;
    if (first === undefined) throw new Error(`\`${name}\` was found and then was not`);

    const doors = found.map(([published, held]) => specifierOf(published, held));
    const also = doors.length > 1 ? [`\nAlso published by: ${doors.slice(1).join(', ')}`] : [];

    // What the name is, and then — once, in one line — that the other half of
    // the question has an answer. Naming the tool rather than printing the sites
    // is the budget: most callers want the signature and stop, and the ones who
    // want the import sites want them ranked against a file this tool never asked
    // for.
    const written = first[2].sites.length;
    const shown =
      written === 0
        ? []
        : [`\ndocs_uses names the ${written} ${written === 1 ? 'place' : 'places'} this is imported, nearest to a file you name first.`];

    return [block(first[0], first[1], first[2]), ...also, ...shown].join('\n');
  },
};
