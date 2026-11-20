import type { FileSet, Spelling, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { limitOf, notShownPast, START_POINT_SCHEMA, spellingOf, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help, Named } from '@variance-authority/package/help';
import { how, sitesByPath, type PathSite } from './by-path.js';
import { FoundNothing, nowhere, specifierOf } from './find.js';
import { memberRows } from './container.js';
import { block, plural } from './format.js';
import { queryDependencyLexicon, type LexiconMatches } from '../dependency-lexicon.js';
import { silentBlocks } from './silent.js';
import { thirdBlock } from './third-party.js';
import { DECLARED_CAP, declarationsNamed, declaredAt, declaredBlocks, isNested, textRows, unreadLine } from './declared.js';
import { uses } from './uses.js';
import { type Members, containerOf, isUnnamedContainer, membersOf, membersStop } from './members.js';
import { exportedRows } from './passed-on.js';
import { answers, boundOf, keyOf, originOf, SLOT } from './declaration-key.js';
import { UNCOUNTED, exportsNamed, importsApart } from './unpublished.js';
import { type Counted, counted, spokenSplit } from './uses-count.js';
import { type PublishedDeclaration, publishedDeclarations, publishingFiles, usesOf } from './uses-of.js';
import { localNames, renamedSites } from './renamed.js';
import { exportedIn, exportedNamed } from './rows.js';
import { symbolAtLine } from './symbol-line.js';

/** Installed declarations shown when the question says no `limit`. */
const INSTALLED_CAP = 100;

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
      name: { type: 'string', description: 'The name, matched exactly; `Container.member` asks for that container\'s member.' },
      package: { type: 'string', description: 'Only answer from this package, by name or by specifier. Optional.' },
      from: {
        ...START_POINT_SCHEMA.from,
        description:
          'Optional. A path in the source tree. An installed third-party name is answered as the manifest that owns ' +
          'that path resolves it: its version and signature there, whether the code already imports it, and where ' +
          'else it is declared when it is not usable there.',
      },
      line: {
        type: 'string',
        description:
          'Optional. `<file>:<line>`, a line that uses the name: its declarations are ordered by how closely the tests ' +
          'that entered each match the recorded tests that ran the line. Overlap of tests, not proof of which one the line called.',
      },
      limit: {
        type: 'integer',
        description: `Rows to show in each list of the answer. ${DECLARED_CAP} declarations of each kind and ${INSTALLED_CAP} installed ones when not said; the rest are counted.`,
      },
    },
    required: ['name'],
    additionalProperties: false,
  },

  run(help, input, invocation) {
    const spell = spellingOf(invocation);
    // Refused before `line` is read, which orders the declarations whole and hands `limit` on to the answer without it.
    const limit = limitOf(input, DECLARED_CAP, spell);
    if (input['line'] !== undefined) return symbolAtLine(help, input, invocation, symbol, declaredInCheckout);
    const installed = limitOf(input, INSTALLED_CAP, spell);
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
    const { blocks: declared } = declaredBlocks(help, invocation?.root, name, wanted, spell, limit, paths);

    // A name no entry publishes, that another package imports by the path of
    // the file exporting it, is used here — and that import is what says so.
    // An import by path of `default` out of a file whose default has a name is that declaration's, not the slot's.
    const byPath = (found.length === 0 ? sitesByPath(help, name, wanted) : []).filter(
      (site) => name !== SLOT || site.held.to === undefined || answers(help, invocation?.root, { at: site.held.to, name }, name),
    );
    // A name an import binds to an export of another name: the import, and the export it names.
    const aliased = localNames(help, invocation?.root, name, wanted).blocks;

    // Exported for a neighbour and never published: the workspace's own name,
    // said first. An installed name it matches is said after it, since a file
    // that passes an installed binding on exports it without declaring it.
    // A published namesake is another declaration, so it never hides this one.
    const exported = unpublishedExports(help, invocation?.root, name, wanted, found.map((one) => [one.at, one.declared] as const));
    const others = exported.length > 0 ? [exportedOnly(help, name, exported, invocation?.root, spell)] : [];
    // A member of an interface, a type literal or a class is the workspace's
    // own declaration too, which no import names and the scan records. It
    // stands beside what a file's top level declares, never under it.
    const members = membersOf(help, invocation?.root, name, wanted);
    const beside = memberBlocks(name, members, spell, limit);
    if (byPath.length > 0) {
      const imported = new Set(byPath.flatMap((site) => [site.held.to ?? site.held.specifier, declaration(help, name, site)?.at ?? '']));
      const rest = exported.filter((held) => !imported.has(held.at));
      return [importedByPath(help, invocation?.root, name, byPath), ...(rest.length > 0 ? [exportedOnly(help, name, rest, invocation?.root, spell)] : []), ...declared, ...aliased, ...beside].join('\n\n');
    }
    const kept = [
      ...(found.length === 0 ? others : []),
      ...(found.length === 0 ? [...declared, ...aliased] : []),
    ];
    // A name declared only as a member names the files whose declarations were
    // not read, since one may declare it at its top level; the declarations beside a member already did.
    const read = kept.length === 0 && beside.length > 0 ? declarationsNamed(help, invocation?.root, name) : undefined;
    const alone = read === undefined || 'refused' in read ? [] : unreadLine(read.unread);
    // A published declaration is answered below, and the members after it.
    const own = found.length === 0 ? [...kept, ...beside, ...alone] : [];
    // Nothing in the workspace answered, so the name may be declared in a file
    // whose declarations were not read: the installed answers below say so.
    const asked = found.length === 0 && own.length === 0 ? declarationsNamed(help, invocation?.root, name) : undefined;
    const unread = asked === undefined || 'refused' in asked ? [] : unreadLine(asked.unread);

    if (found.length === 0 && invocation?.root !== undefined) {
      const everywhere = queryDependencyLexicon(invocation.root, name, undefined, true, wanted, installed);
      // No lexicon of installed names says nothing against the workspace's own export.
      if (everywhere === undefined && own.length > 0) return own.join('\n\n');
      // Without it, what the workspace holds is still an answer: the
      // dependencies are the part of it not checked.
      if (everywhere === undefined) {
        throw new FoundNothing(nowhere(help, name, wanted, invocation.root, members, 'Whether an installed dependency publishes it is not known: the dependency lexicon is not published, and the `variance index` command publishes it.', spell, limit));
      }
      const here = paths === undefined ? everywhere : queryDependencyLexicon(invocation.root, name, paths, true, wanted, installed);
      const shown = here ?? everywhere;
      // A door that declares nothing is a fallback for a package silent about
      // the name; the lexicon leaves out one whose installed copy declares it
      // elsewhere. Another copy of the same version answers nothing for it.
      const silent = silentBlocks(invocation.root, name, shown.silent ?? [], wanted !== undefined);
      const cut = (matches: LexiconMatches): readonly string[] =>
        notShownPast(matches.total, matches.shown.length, spell, { one: 'match', many: 'matches' });
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
      throw new FoundNothing(nowhere(help, name, wanted, invocation?.root, members, checked, spell, limit));
    }

    return [
      ...found.map((one) => publishedBlock(help, input, invocation?.root, spell, one)),
      ...others,
      ...declared,
      ...aliased,
      ...beside,
    ].join('\n\n');
  },

  // The files of this checkout that declare the name, each at its line, by the
  // same readings `run` answers from; an installed declaration is
  // not a file of the checkout, so a name only a dependency declares is unfound.
  files(help, input, invocation): FileSet {
    return declaredInCheckout(help, input, invocation);
  },
};

/** {@link symbol}'s `files`, with the names each declaration is written by. */
export function declaredInCheckout(help: Help, input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help> | undefined): Declared {
  const root = invocation?.root;
  return declaredIn(help, input, invocation, (exported) => declaringExports(stringArg(input, 'name'), exported, root).map(([held]) => held));
}

/** The files that declare a name, each at its lines, and every name each `file:line` is written by there. */
export interface Declared extends FileSet {
  readonly spelled: ReadonlyMap<string, readonly string[]>;
}

/**
 * The files an answer about a name rests on, to be compared with the checkout:
 * those {@link symbol}'s `files` gives, every export of the name, whose imports
 * the answer counts, and for a published declaration each entry and each barrel
 * between that entry and its file, through which the answer teaches its import.
 * The barrels are what the answer's own walk of who imports the name found: it
 * is made once per generation, by whichever of the two comes first, so a look
 * adds stats and no reading.
 */
export function restsOn(help: Help, input: Readonly<Record<string, unknown>>, invocation?: ToolInvocation<Help>): Iterable<string> {
  return [...declaredIn(help, input, invocation, (exported) => exported).files.keys(), ...publishingEntries(help, input, invocation)];
}

/** {@link restsOn} for `uses`, which says nothing of a name bound by `as`, and so rests on no such binding. */
export function usesRestsOn(help: Help, input: Readonly<Record<string, unknown>>, invocation?: ToolInvocation<Help>): Iterable<string> {
  return [...declaredIn(help, input, invocation, (exported) => exported, false).files.keys(), ...publishingEntries(help, input, invocation)];
}

/** The entry file of each door a name is published through, and each file between the entry and the declaration. */
function publishingEntries(help: Help, input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help> | undefined): readonly string[] {
  const from = input['package'];
  const published = publishedDeclarations(help, invocation?.root, stringArg(input, 'name'), typeof from === 'string' && from !== '' ? from : undefined);
  return publishingFiles(help, invocation?.root, published);
}

/** The files that declare a name, each at its lines, with `exports` choosing which of its unpublished exports count. */
function declaredIn(help: Help, input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help> | undefined, exports: (exported: readonly Named[]) => readonly Named[], aliases = true): Declared {
  const name = stringArg(input, 'name');
  const from = input['package'];
  const wanted = typeof from === 'string' && from !== '' ? from : undefined;
  const published = publishedDeclarations(help, invocation?.root, name, wanted);
  const at: (readonly [string, number, ...string[]])[] = published.map((one) => [one.at, one.line, ...one.spellings]);
  if (at.length === 0) {
    for (const site of sitesByPath(help, name, wanted)) {
      const declared = declaration(help, name, site);
      if (declared !== undefined) at.push([declared.at, declared.line, declared.name]);
    }
  }
  const exported = unpublishedExports(help, invocation?.root, name, wanted, published.length > 0 ? published.map((one) => [one.at, one.declared] as const) : at.map(([file]) => [file, name] as const));
  for (const held of exports(exported)) {
    // `export { shout as format }` declares nothing: the function it binds, in the same file, is the declaration.
    const local = boundOf(invocation?.root, held);
    at.push(local !== undefined && local.at === held.at ? [local.at, local.line, local.name, held.name] : [held.at, held.line, held.name]);
    const origin = originOf(help, invocation?.root, held);
    if (origin !== undefined) at.push([origin.at, origin.line, origin.name]);
  }
  const declared = declaredAt(help, invocation?.root, name, wanted);
  at.push(...declared.filter((one) => !isNested(one)).map((one) => [one.at, one.line, one.name] as const));
  if (aliases) at.push(...localNames(help, invocation?.root, name, wanted).files);
  // A member stands beside every other declaration, as `run` answers it.
  const members = membersOf(help, invocation?.root, name, wanted);
  at.push(...declared.filter(isNested).map((one) => [one.at, one.line, one.name] as const));
  // The recording names a method under its class, as `Store/useSessionId`.
  at.push(...members.declared.map((one) => [one.at, one.line, isUnnamedContainer(one.by) ? members.member : `${one.by}/${members.member}`] as const));
  if (at.length === 0) {
    const spell = spellingOf(invocation);
    throw new FoundNothing(nowhere(help, name, wanted, invocation?.root, members, undefined, spell, limitOf(input, DECLARED_CAP, spell)));
  }
  const files = new Map<string, number[]>();
  const spelled = new Map<string, string[]>();
  for (const [file, line, ...names] of at) {
    const lines = files.get(file) ?? [];
    if (!lines.includes(line)) lines.push(line);
    files.set(file, lines);
    const written = spelled.get(`${file}:${line}`) ?? [];
    written.push(...names.filter((one) => !written.includes(one)));
    spelled.set(`${file}:${line}`, written);
  }
  return { files, spelled };
}

/**
 * The member declarations of a name: one block for each of the first
 * `limit`, on the container that holds it, a count of the rest, then
 * the languages whose members were not read; none when no container declares it.
 */
function memberBlocks(name: string, members: Members, spell: Spelling, limit: number): readonly string[] {
  if (members.declared.length === 0) return [];
  const stop = membersStop(members);
  return [
    ...members.declared.slice(0, limit).map((site) =>
      [
        name,
        `a member of ${containerOf(site.by)}, declared at ${site.at}:${site.line}`,
        `\`${spell.tool(uses)}\` names the lines that use it through a value written as its container, and the declaration to ask its language's find-references about for the rest.`,
      ].join('\n'),
    ),
    ...notShownPast(members.declared.length, limit, spell, { one: `member declaration of \`${name}\``, many: `member declarations of \`${name}\`` }),
    ...(stop === undefined ? [] : [stop]),
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
  const listed = usesOf(help, { ...input, file: one.at }, root, spell, one);
  // Inside is the declaring file's package, which a re-exporting door is not.
  const owner = listed.home ?? published.name;
  // One count of the sites `uses` lists feeds the header and the closing line, counted as `uses` counts them.
  const split = counted(listed.sites, owner);
  const may = [...split.off, ...split.whole];
  const shown = listedLine(spell.tool(uses), owner, split, may.length > 0, listed.unread);
  // A default export is headed by the name its declaration is keyed by, as every import of it is read.
  const named = entry.name === SLOT ? keyOf(help, root, { at: entry.at, name: entry.declared }).named : entry.name;
  const renamed = renamedSites(named, listed.sites);
  return [block(published, opening, entry, { may, imported: split.certain.length > 0 }, named), ...memberRows(root, entry.at, entry.declared, entry.line), ...renamed.map((line) => `\n${line}`), ...also, ...shown].join('\n');
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
  const exported = exportsNamed(help, root, name, wanted);
  if (published.length === 0) return exported;
  const declaring = new Set(published.map(([at, declared]) => `${at}\0${declared}`));
  return exported.filter((held) => {
    const { at, named } = keyOf(help, root, held);
    return !declaring.has(`${at}\0${named}`);
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
      ...(name === SLOT ? [] : [`import { ${name} } from '${first.held.specifier}';`]),
      ...(declared === undefined ? [] : [`declared at ${declared.at}:${declared.line}`]),
      why,
      ...(bound === undefined ? [] : textRows(bound)),
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
  if (to !== undefined) return exportedIn(help, to).find((held) => held.name === name);
  const owned = exportedNamed(help, name).filter((held) => held.by === site.owner);
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
function exportedOnly(help: Help, name: string, exported: readonly Named[], root: string | undefined, spell: Spelling): string {
  return declaringExports(name, exported, root)
    .map(([held, within]) => {
      const { declared, rows } = exportedRows(help, root, name, held);
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
  const apart = importsApart(root, exported.map((held) => ({ file: held.at, name: held.name })));
  const read = exported.map((held, at) => [held, apart[at]!] as const);
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
