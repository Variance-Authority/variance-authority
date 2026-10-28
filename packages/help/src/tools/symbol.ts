import type { FileSet, Spelling, Tool } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, spellingOf, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help, Named } from '@variance-authority/package/help';
import { how, sitesByPath, type PathSite } from './by-path.js';
import { FoundNothing, nowhere, specifierOf } from './find.js';
import { memberRows } from './container.js';
import { block, plural } from './format.js';
import { queryDependencyLexicon, type LexiconMatches, type SilentPackage } from '../dependency-lexicon.js';
import { silentBlocks } from './silent.js';
import { thirdBlock } from './third-party.js';
import { declarations, declaredAt, declaredBlocks, isNested, textRows, unreadLine } from './declared.js';
import { uses } from './uses.js';
import { type Members, membersOf, membersStop } from './members.js';
import { boundOf, exportedRows, originOf } from './passed-on.js';
import { UNCOUNTED, exportsNamed, importsOf } from './unpublished.js';
import { type Counted, counted, spokenSplit } from './uses-count.js';
import { type PublishedDeclaration, publishedDeclarations, usesOf } from './uses-of.js';
import { localNames, renamedSites } from './renamed.js';

/**
 * `docs_symbol` — what a name is and where it is declared, in full.
 *
 * Answered for every declaration of the name, each by its file and line, and
 * each for every specifier that publishes it rather than for the first: a
 * declaration reachable from a barrel and from a subpath is one thing with two
 * import lines, and picking one of them for the caller would make the line they
 * write depend on which door this reading walked through first. Two files that
 * declare the name are two things, each answered with its own doors and imports.
 */
export const symbol: Tool<Help> = {
  name: 'docs_symbol',
  description:
    'Everything known about one name: what it is, the import line that reaches it, the ' +
    'file and line that declares it, its full signature, its documentation — or, where nothing is ' +
    'written above it, the README passage that names it — which packages import it, where an import ' +
    'renames it, and the members an interface, a type alias or a class declares, one line each. An export ' +
    'that only passes the name on with `export … from` is followed to the declaration it reaches. Names are ' +
    'matched exactly, including a name exported and not published, answered with where it is declared, a ' +
    'name a file declares and does not export, at its top level or inside a function, answered with where it is written and, inside a function, the function that holds it, a ' +
    'name an import binds with `as`, answered with that import and the original it names, a ' +
    'member of an interface, a type literal or a class, answered with its container and where it is declared, and ' +
    'installed third-party declarations when the API catalogue is ' +
    'published, and, given `from`, as the workspace that owns that path resolves them; use docs_search ' +
    'when the exact name is not known, docs_uses for local import sites.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name, matched exactly.' },
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
    const spell = spellingOf(invocation);
    const name = stringArg(input, 'name');
    const from = input['package'];
    const wanted = typeof from === 'string' && from !== '' ? from : undefined;

    // The door the workspace imports a declaration by leads it. Every adapter
    // that re-exports a core publishes the same declaration, and the first one
    // read is an alphabetical accident whose own count is usually nothing.
    const found = publishedDeclarations(help, invocation?.root, name, wanted);

    // Declared in a file and exported by none: still the workspace's
    // own name, and where it is written says who can reach it. Another file's
    // export of the same name is another thing, so it never stands for this one.
    const at = startPointArg(input, 'from');
    const paths = at === undefined ? undefined : typeof at === 'string' ? [at] : [...at];
    const { blocks: declared, topLevel } = declaredBlocks(invocation?.root, name, wanted, spell, paths);

    // A name no entry publishes, that another package imports by the path of
    // the file exporting it, is used here — and that import is what says so.
    const byPath = found.length === 0 ? sitesByPath(help, name, wanted) : [];
    // A name an import binds to an export of another name: the import, and the export it names.
    const aliased = localNames(help, invocation?.root, name, wanted).blocks;

    // Exported for a neighbour and never published: the workspace's own name,
    // said first. An installed name it matches is said after it, since a file
    // that passes an installed binding on exports it without declaring it.
    // A published namesake is another declaration, so it never hides this one.
    const exported = unpublishedExports(help, invocation?.root, name, wanted, found.map((one) => [one.at, one.declared] as const));
    const others = exported.length > 0 ? [exportedOnly(name, exported, invocation?.root, spell)] : [];
    if (byPath.length > 0) {
      const imported = new Set(byPath.flatMap((site) => [site.held.to ?? site.held.specifier, declaration(help, name, site)?.at ?? '']));
      const rest = exported.filter((held) => !imported.has(held.at));
      return [importedByPath(help, invocation?.root, name, byPath), ...(rest.length > 0 ? [exportedOnly(name, rest, invocation?.root, spell)] : []), ...declared, ...aliased].join('\n\n');
    }
    const kept = [
      ...(found.length === 0 ? others : []),
      ...(found.length === 0 ? [...declared, ...aliased] : []),
    ];
    // A member of an interface, a type literal or a class is the workspace's
    // own declaration too, which no import names and the scan records. It is
    // answered only when nothing at a file's top level, an import that binds
    // the name included, does; a function a body declares is beside it, not over it.
    const top = others.length > 0 || topLevel || aliased.length > 0;
    const members = found.length === 0 && !top ? membersOf(invocation?.root, name, wanted) : undefined;
    const own = members === undefined || members.declared.length === 0 ? kept : [...memberBlocks(invocation?.root, name, members, spell), ...declared];
    // Nothing in the workspace answered, so the name may be declared in a file
    // whose declarations were not read: the installed answers below say so.
    const read = found.length === 0 && own.length === 0 ? declarations(invocation?.root, name) : undefined;
    const unread = read === undefined || 'refused' in read ? [] : unreadLine(read.unread);

    if (found.length === 0 && invocation?.root !== undefined) {
      const everywhere = queryDependencyLexicon(invocation.root, name, undefined, true, wanted, 100);
      // No lexicon of installed names says nothing against the workspace's own export.
      if (everywhere === undefined && own.length > 0) return own.join('\n\n');
      // Without it, what the workspace holds is still an answer: the
      // dependencies are the part of it not checked.
      if (everywhere === undefined) {
        throw new FoundNothing(nowhere(help, name, wanted, invocation.root, members, 'Whether an installed dependency publishes it is not known: the dependency lexicon is not published, and the `variance index` command publishes it.', spell));
      }
      const here = paths === undefined ? everywhere : queryDependencyLexicon(invocation.root, name, paths, true, wanted, 100);
      const shown = here ?? everywhere;
      // A door that declares nothing is a fallback for a package silent about
      // the name; one whose installed copy declares the name elsewhere has
      // answered it. Another copy of the same version answers nothing for it.
      const answered = (one: SilentPackage): boolean =>
        one.installed !== undefined && shown.shown.some((match) => match.installed === one.installed);
      const silent = silentBlocks(invocation.root, name, (shown.silent ?? []).filter((one) => !answered(one)), wanted !== undefined);
      const cut = (matches: LexiconMatches): readonly string[] =>
        matches.total > matches.shown.length ? [`${matches.total - matches.shown.length} more matches not shown.`] : [];
      if (paths !== undefined && here !== undefined && here.total === 0 && everywhere.total > 0) {
        // Not usable at the path is a fact with an answer: the workspaces that do offer it, each with its own version.
        const owner = here.scope.location?.join(', ') ?? 'the manifest that owns it';
        const where = paths.join(', ');
        return [
          ...own,
          `\`${name}\` is not usable from ${where}: ${owner} does not declare or import it. It is offered under:`,
          ...everywhere.shown.map(thirdBlock),
          ...cut(everywhere),
          ...unread,
        ].join('\n\n');
      }
      if (shown.total > 0 || silent.length > 0) return [...own, ...shown.shown.map(thirdBlock), ...cut(shown), ...silent, ...unread].join('\n\n');
    }
    if (own.length > 0) return own.join('\n\n');
    if (found.length === 0) {
      // The lexicon was asked of the package named, when one was, and of no other.
      const checked = invocation?.root === undefined
        ? undefined
        : `No installed dependency${wanted === undefined ? '' : ` named \`${wanted}\``} publishes it either.`;
      throw new FoundNothing(nowhere(help, name, wanted, invocation?.root, members, checked, spell));
    }

    return [
      ...found.map((one) => publishedBlock(help, input, invocation?.root, spell, one)),
      ...others,
      ...declared,
      ...aliased,
    ].join('\n\n');
  },

  // The files of this checkout that declare the name, each at its line, by the
  // same readings `run` answers from; an installed declaration is
  // not a file of the checkout, so a name only a dependency declares is unfound.
  files(help, input, invocation): FileSet {
    const name = stringArg(input, 'name');
    const from = input['package'];
    const wanted = typeof from === 'string' && from !== '' ? from : undefined;
    const published = publishedDeclarations(help, invocation?.root, name, wanted);
    const at: (readonly [string, number])[] = published.map((one) => [one.at, one.line]);
    if (at.length === 0) {
      for (const site of sitesByPath(help, name, wanted)) {
        const declared = declaration(help, name, site);
        if (declared !== undefined) at.push([declared.at, declared.line]);
      }
    }
    {
      const exported = unpublishedExports(help, invocation?.root, name, wanted, published.length > 0 ? published.map((one) => [one.at, one.declared] as const) : at.map(([file]) => [file, name] as const));
      for (const [held] of declaringExports(name, exported, invocation?.root)) {
        at.push([held.at, held.line]);
        const origin = originOf(invocation?.root, held);
        if (origin !== undefined) at.push([origin.at, origin.line]);
      }
    }
    const declared = declaredAt(invocation?.root, name, wanted);
    at.push(...declared.filter((one) => !isNested(one)).map((one) => [one.at, one.line] as const));
    at.push(...localNames(help, invocation?.root, name, wanted).files);
    // A function a body declares stands beside a member, as `run` answers it.
    const members = at.length === 0 ? membersOf(invocation?.root, name, wanted) : undefined;
    at.push(...declared.filter(isNested).map((one) => [one.at, one.line] as const));
    if (members !== undefined) at.push(...members.declared.map((one) => [one.at, one.line] as const));
    if (at.length === 0) throw new FoundNothing(nowhere(help, name, wanted, invocation?.root, members, undefined, spellingOf(invocation)));
    const files = new Map<string, number[]>();
    for (const [file, line] of at) {
      const lines = files.get(file) ?? [];
      if (!lines.includes(line)) lines.push(line);
      files.set(file, lines);
    }
    return { files };
  },
};

/**
 * A name the workspace declares only as a member: one block per declaration,
 * on the container that holds it, then the languages whose members were not
 * read, then the files whose declarations were not read, since one of them
 * may declare it at its top level.
 */
function memberBlocks(root: string | undefined, name: string, members: Members, spell: Spelling): readonly string[] {
  const read = declarations(root, name);
  const stop = membersStop(name, members);
  return [
    ...members.declared.map((site) =>
      [
        name,
        `a member of ${/^a (?:type literal|class)$/u.test(site.by) ? site.by : `\`${site.by}\``}, declared at ${site.at}:${site.line}`,
        `\`${spell.tool(uses)}\` names the lines that use it through a value written as its container, and the declaration to ask its language's find-references about for the rest.`,
      ].join('\n'),
    ),
    ...(stop === undefined ? [] : [stop]),
    ...('refused' in read ? [] : unreadLine(read.unread)),
  ];
}

/**
 * One published declaration: its doors, the one the workspace imports it by
 * first and the rest as "also published by", where it is declared, and one line
 * naming the tool that lists its sites, counted for this declaration alone:
 * callers who want them want them ranked against a file this tool never asked for.
 */
function publishedBlock(help: Help, input: Readonly<Record<string, unknown>>, root: string | undefined, spell: Spelling, one: PublishedDeclaration): string {
  const [[published, opening, entry], ...more] = one.doors as [PublishedDeclaration['doors'][number], ...PublishedDeclaration['doors']];
  const also = more.length > 0 ? [`\nAlso published by: ${more.map(([held, door]) => specifierOf(held, door)).join(', ')}`] : [];
  // The sites of this declaration are the ones `uses` lists when asked for its file.
  const listed = usesOf(help, { ...input, file: one.at }, root, spell);
  // Inside is the declaring file's package, which a re-exporting door is not.
  const owner = listed.home ?? published.name;
  // One count of the sites `uses` lists feeds the header and the closing line, counted as `uses` counts them.
  const split = counted(listed.sites, owner);
  const may = [...split.off, ...split.whole];
  const shown = listedLine(spell.tool(uses), owner, split, may.length > 0, listed.unread);
  const renamed = renamedSites(entry.name, listed.sites);
  return [block(published, opening, entry, { may, imported: split.certain.length > 0 }), ...memberRows(root, entry.at, entry.name, entry.line), ...renamed.map((line) => `\n${line}`), ...also, ...shown].join('\n');
}

/**
 * The exports of the name no entry publishes: every export of ordinary source
 * whose declaration is none of `published`, each a file and the name the
 * published entries' declaration is declared by there. A barrel that passes a
 * published declaration on is that declaration, and another binding, in its
 * file or another, is another thing.
 */
function unpublishedExports(
  help: Help,
  root: string | undefined,
  name: string,
  wanted: string | undefined,
  published: readonly (readonly [string, string])[],
): readonly Named[] {
  const exported = exportsNamed(help, name, wanted);
  if (published.length === 0) return exported;
  const declaring = new Set(published.map(([at, declared]) => `${at}\0${declared}`));
  return exported.filter((held) => {
    const origin = held.declaration !== undefined ? undefined : originOf(root, held);
    return !declaring.has(`${origin?.at ?? held.at}\0${origin?.name ?? held.name}`);
  });
}

/**
 * One name no entry publishes, answered from the imports that name its file:
 * one block per file, each with the import line, where the name is declared,
 * why it is not published, and every import of it.
 */
function importedByPath(help: Help, root: string | undefined, name: string, sites: readonly PathSite[]): string {
  const files = new Map<string, PathSite[]>();
  for (const site of sites) {
    const file = site.held.to ?? site.held.specifier;
    files.set(file, [...(files.get(file) ?? []), site]);
  }
  const blocks = [...files.values()].map((held) => {
    const [first] = held;
    if (first === undefined) return '';
    const exported = declaration(help, name, first);
    const bound = exported === undefined ? undefined : boundOf(root, exported);
    const declared = bound ?? exported;
    const why = {
      deep: `not published: ${first.owner} declares an entry, and this file is not behind it.`,
      byPath: `not published: ${first.owner} declares no entry, so every import of it names a file.`,
      unfollowed: `not listed: ${first.owner} declares ${first.held.specifier} as an entry, and this reading could not follow it to a source file.`,
    }[first.kind];
    return [
      bound === undefined ? name : `${name} [${bound.kind}]`,
      ...(name === 'default' ? [] : [`import { ${name} } from '${first.held.specifier}';`]),
      ...(declared === undefined ? [] : [`declared at ${declared.at}:${declared.line}`]),
      why,
      ...(root === undefined || bound === undefined ? [] : textRows(root, bound)),
      '',
      `Imported by path in ${held.length} ${held.length === 1 ? 'place' : 'places'}:`,
      ...held.map((site) => `  ${site.taken.at}:${site.taken.line} — ${site.taken.by}${how(site)}${site.taken.local === undefined ? '' : ` (as ${site.taken.local})`}${site.taken.type ? ' (type only)' : ''}`),
    ].join('\n');
  });
  return blocks.join('\n\n');
}

/**
 * The line that sends the asker to `uses`: how many places import the name,
 * those from other packages and those inside `owner`, each counted, and that
 * it lists the places that may read it, which the header counts. The sites are
 * the ones `uses` lists, counted as it counts them. An index that did not read
 * leaves the ones inside uncounted, and says why.
 */
function listedLine(tool: string, owner: string, count: Counted, may: boolean, unread: string | undefined): readonly string[] {
  const { certain } = count;
  if (certain.length === 0 && !may && unread === undefined) return [];
  const left = unread === undefined ? '' : ` The imports inside ${owner} are read from the source index, and ${unread}.`;
  if (certain.length === 0) {
    const where = may ? 'names no place that imports this, and lists the ones that may read it' : 'names no place another package imports this from';
    return [`\n\`${tool}\` ${where}.${left}`];
  }
  const also = may ? ', and the ones that may read it' : '';
  return [`\n\`${tool}\` names the ${plural(certain.length, 'place')} that ${certain.length === 1 ? 'imports' : 'import'} this${spokenSplit(count, owner)}, nearest to a file you name first${also}.${left}`];
}

/**
 * Where the name an import takes is declared: the export in the file the index
 * resolved the import to, or, when the reading has no resolution, the one
 * export of that name its package holds. Two candidates and no resolution is
 * no answer, and says nothing.
 */
function declaration(help: Help, name: string, site: PathSite): Named | undefined {
  const to = site.held.to;
  if (to !== undefined) return help.exported.find((held) => held.name === name && held.at === to);
  const owned = help.exported.filter((held) => held.name === name && held.by === site.owner);
  return owned.length === 1 ? owned[0] : undefined;
}

/**
 * One name a file exports and no entry publishes: where each export is written,
 * the line itself when the checkout is at hand, and how many imports the source
 * index resolved to that file, or to a file that passes the name on from it.
 * Exports that share a name are told apart, each with the imports of its own
 * file. A file that passes on another one's export is not told apart: its
 * imports are counted with the export it passes on, once. An export that
 * passes on a declaration of another file is followed to it, and that line is
 * shown too. The members of an interface, a type alias or a class come last.
 */
function exportedOnly(name: string, exported: readonly Named[], root: string | undefined, spell: Spelling): string {
  return declaringExports(name, exported, root)
    .map(([held, within]) => {
      const { declared, rows } = exportedRows(root, name, held);
      return [
        ...rows,
        ...('uses' in within ? [importedIn(within.uses.length, spell), ...renamedSites(name, within.uses)] : root === undefined ? [] : [`Who imports it is read from the source index, and ${within.unread}.`]),
        ...memberRows(root, declared.at, declared.name, declared.line),
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * The exports of a name that declare it, each with the imports the source index
 * resolved to it: a file that passes on another one's export is left out.
 */
function declaringExports(name: string, exported: readonly Named[], root: string | undefined) {
  const read = exported.map((held) => [held, importsOf(root, [held.at], name)] as const);
  const passing = new Set(read.flatMap(([, within]) => ('through' in within ? within.through : [])));
  // Files that pass the name on to each other and declare it nowhere else are all shown.
  const declaring = read.filter(([held]) => !passing.has(held.at));
  return declaring.length > 0 ? declaring : read;
}

/** How many places import one export, read off the source index. */
function importedIn(count: number, spell: Spelling): string {
  return count === 0
    ? `Nothing in this workspace imports it; ${UNCOUNTED}.`
    : `Imported in ${count} ${count === 1 ? 'place' : 'places'}; \`${spell.tool(uses)}\` lists them, nearest to a file you name first.`;
}
