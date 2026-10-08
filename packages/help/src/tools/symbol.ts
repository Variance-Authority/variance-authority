import type { Tool } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { how, sitesByPath, type PathSite } from './by-path.js';
import { entriesNamed, isPackage, specifierOf, unfound } from './find.js';
import { block } from './format.js';
import { queryDependencyLexicon, type LexiconMatches, type SilentPackage, type ThirdPartyMatch } from '../dependency-lexicon.js';
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

    // The door the workspace imports the name by leads. Every adapter that
    // re-exports a core publishes the same declaration, and the first one read
    // is an alphabetical accident whose own count is usually nothing. Equal
    // counts fall to the published name, by code unit, so the answer does not
    // follow the order the workspace's directories were read in.
    const found = entriesNamed(help, name)
      .filter(([published, held]) => wanted === undefined || isPackage(published, held, wanted))
      .sort(([left, leftDoor, a], [right, rightDoor, b]) =>
        b.usedBy.length - a.usedBy.length || b.uses - a.uses ||
        byCodeUnit(left.name, right.name) || byCodeUnit(leftDoor.subpath, rightDoor.subpath));

    // A name no entry publishes, that another package imports by the path of
    // the file exporting it, is used here — and that import is what says so.
    const byPath = found.length === 0 ? sitesByPath(help, name, wanted) : [];
    if (byPath.length > 0) return importedByPath(help, name, byPath);

    if (found.length === 0 && invocation?.root !== undefined) {
      const at = startPointArg(input, 'from');
      const paths = at === undefined ? undefined : typeof at === 'string' ? [at] : [...at];
      const everywhere = queryDependencyLexicon(invocation.root, name, undefined, true, wanted, 100);
      if (everywhere === undefined) throw new Error(`the dependency lexicon is not published; run \`variance index\` before asking about \`${name}\``);
      const here = paths === undefined ? everywhere : queryDependencyLexicon(invocation.root, name, paths, true, wanted, 100);
      const shown = here ?? everywhere;
      // A door that declares nothing is a fallback for a package silent about
      // the name; one whose package declares the name elsewhere has answered it.
      const answered = (one: SilentPackage): boolean =>
        shown.shown.some((match) => match.package === one.package && match.version === one.version);
      const silent = silentBlocks(invocation.root, name, (shown.silent ?? []).filter((one) => !answered(one)), wanted !== undefined);
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
      if (shown.total > 0 || silent.length > 0) return [...shown.shown.map(described), ...cut(shown), ...silent].join('\n\n');
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

/** Code-unit order, so a tie never depends on `LANG`. */
function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * One name no entry publishes, answered from the imports that name its file:
 * one block per file, each with the import line, where the name is declared,
 * why it is not published, and every import of it.
 */
function importedByPath(help: Help, name: string, sites: readonly PathSite[]): string {
  const files = new Map<string, PathSite[]>();
  for (const site of sites) {
    const file = site.held.to ?? site.held.specifier;
    files.set(file, [...(files.get(file) ?? []), site]);
  }
  const blocks = [...files.values()].map((held) => {
    const [first] = held;
    if (first === undefined) return '';
    const declared = declaration(help, name, first);
    const why = {
      deep: `not published: ${first.owner} declares an entry, and this file is not behind it.`,
      byPath: `not published: ${first.owner} declares no entry, so every import of it names a file.`,
      unfollowed: `not listed: ${first.owner} declares ${first.held.specifier} as an entry, and this reading could not follow it to a source file.`,
    }[first.kind];
    return [
      name,
      ...(name === 'default' ? [] : [`import { ${name} } from '${first.held.specifier}';`]),
      ...(declared === undefined ? [] : [`declared at ${declared.at}:${declared.line}`]),
      why,
      '',
      `Imported by path in ${held.length} ${held.length === 1 ? 'place' : 'places'}:`,
      ...held.map((site) => `  ${site.taken.at}:${site.taken.line} — ${site.taken.by}${how(site)}${site.taken.type ? ' (type only)' : ''}`),
    ].join('\n');
  });
  return blocks.join('\n\n');
}

/**
 * Where the name an import takes is declared: the export in the file the index
 * resolved the import to, or, when the reading has no resolution, the one
 * export of that name its package holds. Two candidates and no resolution is
 * no answer, and says nothing.
 */
function declaration(help: Help, name: string, site: PathSite): { readonly at: string; readonly line: number } | undefined {
  const to = site.held.to;
  if (to !== undefined) return help.exported.find((held) => held.name === name && held.at === to);
  const owned = help.exported.filter((held) => held.name === name && held.by === site.owner);
  return owned.length === 1 ? owned[0] : undefined;
}
