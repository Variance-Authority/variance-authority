import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSet, Tool } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help, Named } from '@variance-authority/package/help';
import { how, sitesByPath, type PathSite } from './by-path.js';
import { entriesNamed, isPackage, specifierOf, unfound } from './find.js';
import { block } from './format.js';
import { queryDependencyLexicon, type LexiconMatches, type SilentPackage } from '../dependency-lexicon.js';
import { silentBlocks } from './silent.js';
import { thirdBlock } from './third-party.js';
import { DECLARED_CAP, declarations, declaredAt, declaredBlocks, unreadLine } from './declared.js';
import { containerOf, type Members, membersOf } from './members.js';
import { UNCOUNTED, exportsNamed, importsOf } from './unpublished.js';
import { localNames, renamedSites } from './renamed.js';

/**
 * `docs_symbol` — what a name is and where it is declared, in full.
 *
 * Answered for every specifier that publishes it rather than for the first,
 * because a declaration reachable from a barrel and from a subpath is one thing
 * with two import lines, and picking one of them for the caller would make the
 * line they write depend on which door this reading walked through first.
 */
export const symbol: Tool<Help> = {
  name: 'docs_symbol',
  description:
    'Everything known about one name: what it is, the import line that reaches it, the ' +
    'file and line that declares it, its full signature, its documentation — or, where nothing is ' +
    'written above it, the README passage that names it — which packages import it, and where an ' +
    'import renames it. Names are ' +
    'matched exactly, including a name exported and not published, answered with where it is declared, a ' +
    'name a file declares at its top level and does not export, answered with where it is written, a ' +
    'name an import binds with `as`, answered with that import and the original it names, a ' +
    'member of a TypeScript interface or type literal, a TypeScript or JavaScript class, a Java, Kotlin or Swift ' +
    'type, or a Python class, answered with its container and where it is declared, beside any ' +
    'top-level declaration of the same name, and ' +
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
    const name = stringArg(input, 'name');
    const from = input['package'];
    const wanted = typeof from === 'string' && from !== '' ? from : undefined;

    // The door the workspace imports the name by leads. Every adapter that
    // re-exports a core publishes the same declaration, and the first one read
    // is an alphabetical accident whose own count is usually nothing. Equal
    // counts fall to the published name, by code unit, so the answer does not
    // follow the order the workspace's directories were read in.
    const found = [...publishing(help, name, wanted)]
      .sort(([left, leftDoor, a], [right, rightDoor, b]) =>
        b.usedBy.length - a.usedBy.length || b.uses - a.uses ||
        byCodeUnit(left.name, right.name) || byCodeUnit(leftDoor.subpath, rightDoor.subpath));

    // Declared in a file and exported by none: still the workspace's
    // own name, and where it is written says who can reach it. Another file's
    // export of the same name is another thing, so it never stands for this one.
    const declared = declaredBlocks(invocation?.root, name, wanted);

    // A name no entry publishes, that another package imports by the path of
    // the file exporting it, is used here — and that import is what says so.
    const byPath = found.length === 0 ? sitesByPath(help, name, wanted) : [];
    // A name an import binds to an export of another name: the import, and the export it names.
    const aliased = localNames(help, invocation?.root, name, wanted).blocks;
    // A member of an interface, a type literal, a class or another language's
    // type is the workspace's own declaration too, which no import names and
    // the scan records. A top-level name that shares its spelling is another
    // declaration, so it never stands for the member: both are answered.
    const members = membersOf(invocation?.root, name, wanted);
    const memberOwn = memberBlocks(invocation?.root, name, members);
    if (byPath.length > 0) return [importedByPath(help, name, byPath), ...declared, ...aliased, ...memberOwn].join('\n\n');

    // Exported for a neighbour and never published: the workspace's own name,
    // said first. An installed name it matches is said after it, since a file
    // that passes an installed binding on exports it without declaring it.
    const exported = found.length === 0 ? exportsNamed(help, name, wanted) : [];
    // The files whose declarations were not read are said once, after every
    // declaration: `declared` says them when it answers anything.
    const own = [
      ...(exported.length > 0 ? [exportedOnly(name, exported, invocation?.root)] : []),
      ...(found.length === 0 ? [...declared, ...aliased] : []),
      ...(found.length === 0 ? memberOwn : []),
      ...(found.length === 0 && declared.length === 0 && memberOwn.length > 0 ? unreadOf(invocation?.root, name) : []),
    ];
    // Nothing in the workspace answered, so the name may be declared in a file
    // whose declarations were not read: the installed answers below say so.
    const read = found.length === 0 && own.length === 0 ? declarations(invocation?.root, name) : undefined;
    const unread = read === undefined || 'refused' in read ? [] : unreadLine(read.unread);

    if (found.length === 0 && invocation?.root !== undefined) {
      const at = startPointArg(input, 'from');
      const paths = at === undefined ? undefined : typeof at === 'string' ? [at] : [...at];
      const everywhere = queryDependencyLexicon(invocation.root, name, undefined, true, wanted, 100);
      // No lexicon of installed names says nothing against the workspace's own export.
      if (everywhere === undefined && own.length > 0) return own.join('\n\n');
      // Without it, what the workspace holds is still an answer: the
      // dependencies are the part of it not checked.
      if (everywhere === undefined) {
        throw new Error(nowhere(help, name, wanted, invocation.root, members, 'Whether an installed dependency publishes it is not known: the dependency lexicon is not published, and `variance index` publishes it.'));
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
      throw new Error(nowhere(help, name, wanted, invocation?.root, members, checked));
    }

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
        : [`\ndocs_uses names the ${written} ${written === 1 ? 'place' : 'places'} another package imports this by its published path, and the imports the source index resolves to its file, nearest to a file you name first.`];

    // The imports within a package are the source index's, which the Help value does not record.
    const declaring = [...new Set(found.map(([, , entry]) => entry.at))];
    const within = importsOf(invocation?.root, declaring, name);
    const renamed = renamedSites(name, [...found.flatMap(([, , entry]) => entry.sites), ...('uses' in within ? within.uses : [])]);

    return [[block(first[0], first[1], first[2]), ...renamed.map((line) => `\n${line}`), ...also, ...shown].join('\n'), ...declared, ...aliased, ...memberOwn].join('\n\n');
  },

  // The files of this checkout that declare the name, each at its line, by the
  // same readings `run` answers from; an installed declaration is
  // not a file of the checkout, so a name only a dependency declares is unfound.
  files(help, input, invocation): FileSet {
    const name = stringArg(input, 'name');
    const from = input['package'];
    const wanted = typeof from === 'string' && from !== '' ? from : undefined;
    const at: (readonly [string, number])[] = publishing(help, name, wanted).map(([, , entry]) => [entry.at, entry.line]);
    if (at.length === 0) {
      for (const site of sitesByPath(help, name, wanted)) {
        const declared = declaration(help, name, site);
        if (declared !== undefined) at.push([declared.at, declared.line]);
      }
    }
    if (at.length === 0) {
      const exported = exportsNamed(help, name, wanted);
      for (const [held] of declaringExports(name, exported, invocation?.root)) at.push([held.at, held.line]);
    }
    at.push(...declaredAt(invocation?.root, name, wanted).map((one) => [one.at, one.line] as const));
    at.push(...localNames(help, invocation?.root, name, wanted).files);
    const members = membersOf(invocation?.root, name, wanted);
    at.push(...members.declared.map((one) => [one.at, one.line] as const));
    if (at.length === 0) throw new Error(nowhere(help, name, wanted, invocation?.root, members, undefined));
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
 * The member declarations of a name: one block per declaration, on the
 * container that holds it, with the line as the checkout writes it, the first
 * `DECLARED_CAP` of them and a count of the rest, which `docs_uses` lists.
 */
function memberBlocks(root: string | undefined, name: string, members: Members): readonly string[] {
  const more = members.declared.length - DECLARED_CAP;
  return [
    ...members.declared.slice(0, DECLARED_CAP).map((site) =>
      [
        name,
        `a member of ${containerOf(site.by)}, declared at ${site.at}:${site.line}${site.package === '' ? '' : ` by ${site.package}`}`,
        ...(root === undefined ? [] : lineAt(root, site.at, site.line, name)),
        members.unrecorded.includes(site)
          ? 'docs_uses names the search that finds the lines that use it, as text: no reader of this file records them.'
          : 'docs_uses names the lines that use it through a value written as its container, and the search that finds the rest.',
      ].join('\n'),
    ),
    ...(more > 0 ? [`${more} more member ${more === 1 ? 'declaration' : 'declarations'} of \`${name}\` not shown; docs_uses lists more, and its \`package\` narrows them to one package.`] : []),
  ];
}

/** The files whose declarations the source index did not read, said once. */
function unreadOf(root: string | undefined, name: string): readonly string[] {
  const read = declarations(root, name);
  return 'refused' in read ? [] : unreadLine(read.unread);
}

/**
 * The refusal of a name nothing in the workspace declares: that no file
 * declares it, then, given `dependencies`, what is known of the installed
 * ones, then the files the source index holds no declarations of. Where the
 * index could not be read, that is said in place of a claim about the files.
 */
function nowhere(
  help: Help,
  name: string,
  wanted: string | undefined,
  root: string | undefined,
  members: Members | undefined,
  dependencies: string | undefined,
): string {
  const where = wanted === undefined ? 'this workspace' : `\`${wanted}\``;
  const read = declarations(root, name);
  const why = 'refused' in read ? read.refused : members?.unread;
  const unread = 'refused' in read ? [] : unreadLine(read.unread);
  // What was read and found nothing comes first, as only what was read; what was not read, last.
  const files = why === undefined
    ? `No file in ${where}${unread.length === 0 ? '' : ' that the source index read'} declares \`${name}\`, at its top level or as a member.`
    : `Which files declare \`${name}\` is not known: ${why}.`;
  return [unfound(help, name, wanted), files, ...(dependencies === undefined ? [] : [dependencies]), ...unread].join(' ');
}

/** Every published entry of the name, from the package asked for when one was. */
function publishing(help: Help, name: string, wanted: string | undefined) {
  return entriesNamed(help, name).filter(([published, held]) => wanted === undefined || isPackage(published, held, wanted));
}

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
      ...held.map((site) => `  ${site.taken.at}:${site.taken.line} — ${site.taken.by}${how(site)}${site.taken.local === undefined ? '' : ` (as ${site.taken.local})`}${site.taken.type ? ' (type only)' : ''}`),
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

/**
 * One name a file exports and no entry publishes: where each export is written,
 * the line itself when the checkout is at hand, and how many imports the source
 * index resolved to that file, or to a file that passes the name on from it.
 * Exports that share a name are told apart, each with the imports of its own
 * file. A file that passes on another one's export is not told apart: its
 * imports are counted with the export it passes on, once.
 */
function exportedOnly(name: string, exported: readonly Named[], root: string | undefined): string {
  return declaringExports(name, exported, root)
    .map(([held, within]) =>
      [
        name,
        `exported, without being published, at ${held.at}:${held.line} by ${held.by}${held.type ? ' (type only)' : ''}`,
        ...(root === undefined ? [] : lineOf(root, held)),
        ...('uses' in within ? [importedIn(within.uses.length), ...renamedSites(name, within.uses)] : root === undefined ? [] : [`Who imports it is read from the source index, and ${within.unread}.`]),
      ].join('\n'),
    )
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
function importedIn(count: number): string {
  return count === 0
    ? `Nothing in this workspace imports it; ${UNCOUNTED}.`
    : `Imported in ${count} ${count === 1 ? 'place' : 'places'}; docs_uses lists them, nearest to a file you name first.`;
}

/**
 * The line an export is written on, as the checkout holds it now; nothing when
 * the file is gone or the line no longer holds the name, since the index read
 * an older text.
 */
function lineOf(root: string, held: Named): readonly string[] {
  return lineAt(root, held.at, held.line, held.name);
}

/** Line `line` of `file` as the checkout holds it now, trimmed; nothing when the file is gone or the line no longer holds `name`. */
function lineAt(root: string, file: string, line: number, name: string): readonly string[] {
  let text: string;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    return [];
  }
  const written = text.split(/\r?\n/)[line - 1]?.trim();
  return written === undefined || !written.includes(name) ? [] : [written];
}
