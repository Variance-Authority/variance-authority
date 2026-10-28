import type { FileSet, Spelling, Tool } from '@variance-authority/mcp/tools';
import { limitOf, notShown, spellingOf } from '@variance-authority/mcp/tools';
import type { Help, Use } from '@variance-authority/package/help';
import type { DeclaredName } from '@variance-authority/sense';
import { unreadLine } from './declared.js';
import { type Members, places, routes } from './members.js';
import { passesOn } from './passed-on.js';
import { sharedSegments } from './shared-segments.js';
import { symbol } from './symbol.js';
import { UNCOUNTED, exportedAt } from './unpublished.js';
import { bracketed, keptLine, namesakeLine, narrowing, publishedAt, renamed } from './uses-declarations.js';
import { type Counted, apart, counted, spokenSplit } from './uses-count.js';
import { type Answer, type Namesake, type Site, packageOf, usesOf } from './uses-of.js';

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
 * is there at all can depend on a path the program takes. A read off the
 * module's `default`, which holds the name only when the module is CommonJS,
 * and a module passed on whole, where this reading does not follow it, are each
 * listed as a site that may read the name and counted apart from the imports:
 * neither is a use of it.
 *
 * ## An import by path is a site
 *
 * A name no entry publishes is still used when another package imports the file
 * that exports it. That import is listed like any other, saying whether it is a
 * deep import — past the entry its package declares — or an import from a
 * package that declares none.
 *
 * ## An import within the package is a site
 *
 * The Help value records the imports that cross a package. The rest are read
 * off the source index: every import that resolved to the file declaring the
 * name, or to a file that passes it on with `export … from`, which is followed
 * under the name it exports and is not itself a use. An import of the name
 * under another name says which. A name a file exports and no entry publishes
 * is answered from there alone. Asked for one specifier of a package, an
 * import through another specifier of it is left to that one.
 *
 * An index that is missing or does not read leaves the imports by package path
 * standing, and the answer says the rest were not read and why.
 *
 * ## A use in the declaring file is a site
 *
 * The file that declares a name uses it by scope, and no import says so: a
 * call, a value, a type, a path `self::name`, a test module's `use super::*`.
 * The scan reads those lines with the file's parse, by the reader's scope
 * rules, so a parameter, a local or an inner item of the same name is another
 * name and its lines are not listed, and neither is the declaration. They are
 * listed after the imports, under the file, for an exported name and for one
 * the file keeps to itself. The TypeScript, JavaScript and Rust readers record
 * them.
 *
 * ## A member is declared, not imported
 *
 * A method or property of an interface, a type literal or a class is reached
 * through a value, so no import names it, and this question, which answers by
 * imports, lists its declarations as well, each on its container: after the
 * imports when an export has the name too, alone when none does. The scan
 * records every member declaration with the file's parse, so reading them is a
 * lookup in the source index.
 *
 * Each declaration on a named container is followed by its uses: the lines
 * that read, write or destructure the member through a value whose type the
 * line writes as that container — an annotation, an `as`, a `satisfies`. The
 * type's name is joined to its declaration the way an import is, so two
 * containers that share a member's name each get their own uses, and a value
 * typed as neither is a use of neither. What a type checker would infer is the
 * checker's of the declaration's language: the answer says so and names the
 * declaration to ask it about.
 */

/** Sites of one kind shown when `limit` is not said: how many are worth naming before the list stops being read. */
const SHOWN = 12;

/** How many sites of each kind are shown, and how the answer names what to ask next. */
interface Shown {
  readonly limit: number;
  readonly spell: Spelling;
}

/** How the sites are ordered, said once above them. */
function nearestLine(from: string | undefined, spell: Spelling): string {
  return from === undefined ? `Path order; \`${spell.input('from')}\` sorts nearest first.` : `Nearest to ${from} first.`;
}

function order(sites: readonly Site[], from: string | undefined): readonly Site[] {
  return [...sites].sort(
    (a, b) =>
      (from === undefined ? 0 : sharedSegments(from, b.at) - sharedSegments(from, a.at)) ||
      (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) ||
      a.line - b.line,
  );
}

/**
 * The first `limit` sites of `name` under `heading`, each marked with the name
 * its file knows it by when that is another: the one its import binds it to
 * with `as`, or else the one a re-export renamed it to.
 */
function listed(sites: readonly Site[], heading: string, name: string, shown: Shown): readonly string[] {
  if (sites.length === 0) return [];

  const cut = sites.slice(0, shown.limit);
  const rest = sites.length - cut.length;
  const renamed = (use: Site): string => {
    const known = use.local ?? use.name;
    return known === undefined || known === name ? '' : ` (as ${known})`;
  };
  return [
    '',
    heading,
    '',
    ...cut.map((use) => `${use.at}:${use.line} — ${use.by}${use.how ?? ''}${renamed(use)}${use.type ? ' (type only)' : ''}${held(use)}${usedOn(use.lines, shown)}`),
    ...(rest > 0 ? [`… ${notShown(rest, shown.spell)}`] : []),
  ];
}

/**
 * The lines of an importing file that use what its import binds, the first
 * `limit` of them and the rest counted; nothing when none were read.
 */
function usedOn(lines: readonly number[] | undefined, shown: Shown): string {
  if (lines === undefined || lines.length === 0) return '';
  const cut = lines.slice(0, shown.limit);
  const rest = lines.length - cut.length;
  return `; used on ${lines.length === 1 ? 'line' : 'lines'} ${cut.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}

/**
 * Where a name read off a module held whole was loaded, and when; whether it
 * was read off the module's `default`; and whether the module went on, whole,
 * where this reading does not follow it, so the line may read the name.
 */
function held(use: Use): string {
  if (use.through === undefined) return '';
  const loaded = use.through.kind === 'dynamic' ? `import() on line ${use.through.line}` : `namespace, line ${use.through.line}`;
  const off = use.through.throughDefault === true ? ', through `default`: may read it' : '';
  const whole = use.through.whole === true ? ', passed on whole: may read it' : '';
  return ` (${loaded}${off}${whole})`;
}

/**
 * `docs_uses`: every place a name is imported or read, for each declaration of
 * it.
 */
export const uses: Tool<Help> = {
  name: 'docs_uses',
  description:
    'Every file:line in the workspace that imports one exported name, including reads through ' +
    '`import()` or `import * as`, marked with the line that loads the module, and imports that ' +
    'name the file by path, marked as such. Imports within the exporting package are read from the ' +
    'source index, through each `export … from` that passes the name on, so a ' +
    'name exported and not published is answered too. A site is marked `(as x)` where its import or a re-export ' +
    'renames the name, and with the lines its file uses what the import binds on. The imports inside the declaring package and the ones from ' +
    'other packages are counted and listed apart. The lines of the declaring file that use the name are listed after the imports. A member of an interface, a type literal or a class by that ' +
    'name is listed with its declarations, after the imports, each with the lines that read, write or destructure ' +
    'it through a value whose type is written as its container and the members of the classes that write `implements` of it, ' +
    "and the declaration to ask its language's find-references and go-to-implementation about for the uses and implementations no line types. A top-level " +
    'name a file declares and does not export is answered with its kind, where it is declared and who can reach it there. Stories ' +
    'and tests are listed apart. `from`, the file you are in, sorts sites by shared path; `limit` says how many sites of ' +
    'each kind are shown. A name only passed on with `export … from` is followed to the declaration it reaches. ' +
    'A name an entry publishes only inside `export * as ns` is said to be published as `ns.name`, and a read ' +
    'through a namespace inside a namespace or one passed on as `default` is a site. ' +
    'Each file declaring the name declares another thing: the answer lists every one with its own imports, kept ' +
    'apart, and `file`, the file one is declared in or a file passing it on, answers for that declaration alone.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The exported name or member name, matched exactly.' },
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
      file: {
        type: 'string',
        description:
          'The file the name is declared in, or a file that passes it on with `export … from`, relative to the workspace root, ' +
          'to answer for that declaration alone among namesakes. Optional.',
      },
      limit: { type: 'integer', description: `Sites of each kind to show. ${SHOWN} when not said; the rest are counted.` },
    },
    required: ['name'],
    additionalProperties: false,
  },

  run(help, input, invocation) {
    const spell = spellingOf(invocation);
    const shown: Shown = { limit: limitOf(input, SHOWN, spell), spell };
    const answer = usesOf(help, input, invocation?.root, spell);
    return [answered(answer, input, shown), ...narrowing(answer.files, answer.file, spell)].join('\n');
  },

  // Every file importing the name, at each line that does, or every file
  // declaring it as a member, read as `run` reads them; an index that did not
  // read leaves the imports within the package unread.
  files(help, input, invocation): FileSet {
    const { namesakes, sites, unread, members, kept, keptSites, inFile, keptInFile } = usesOf(help, input, invocation?.root, spellingOf(invocation));
    const files = new Map<string, number[]>();
    const others = namesakes.flatMap((one) => [...one.sites, ...one.inFile]);
    for (const site of [...sites, ...inFile, ...others, ...members.declared, ...members.used.flatMap((one) => one.uses), ...kept, ...keptSites, ...keptInFile]) {
      files.set(site.at, [...new Set([...(files.get(site.at) ?? []), site.line])].sort((left, right) => left - right));
    }
    return { files, ...(unread === undefined ? {} : { unread: [`imports within the package: ${unread}`] }) };
  },
};

/** The answer `docs_uses` gives, before the line on how to ask for one declaration. */
function answered(answer: Answer, input: Readonly<Record<string, unknown>>, shown: Shown): string {
  const from = typeof input['from'] === 'string' && input['from'] !== '' ? input['from'] : undefined;
  const { name, members, exported, found, byPath, kept } = answer;
  const declared = members.declared.length;
  // A name no file exports may be declared in a file whose declarations
  // were not read, so the answer names those files after what it found.
  const unread = unreadLine(answer.undeclared);
  const keeping = keptLines(name, kept, answer.keptSites, answer.keptInFile, from, shown);
  if (found.length === 0 && byPath.length === 0 && exported.length === 0) {
    if (kept.length > 0 && declared === 0) return [...keeping, ...unread].join('\n');
    if (kept.length > 0) return [...keeping, '', `\`${name}\` is a member too, declared in ${places(declared)}:`, ...memberLines(members, from, name, shown), ...unread].join('\n');
    return [`\`${name}\` is no exported name; it is a member, declared in ${places(declared)}:`, ...memberLines(members, from, name, shown), ...unread].join('\n');
  }
  // A file that keeps a name of its own is another thing than the export of that name.
  const imports = [
    imported(answer, from, ownLines(answer.inFile, name, shown), shown),
    ...namesakeLines(name, answer.namesakes, from, shown),
    ...(kept.length === 0 ? [] : ['', ...keeping]),
  ].join('\n');
  // An index the imports already said did not read is not said twice.
  if (declared === 0 && members.unread !== undefined && answer.unread === undefined) {
    return `${imports}\n\nMembers by this name were not read: ${members.unread}.`;
  }
  if (declared === 0) return imports;
  // The imports already said the order, so the members do not say it again.
  const lines = memberLines(members, from, name, shown).slice(1);
  return [imports, '', `\`${name}\` is a member too, declared in ${places(declared)}:`, ...lines].join('\n');
}

/**
 * Each declaration beside the one answered first, published or exported, with
 * its own imports and its own file's uses of it, kept apart as a kept one is.
 */
function namesakeLines(name: string, namesakes: readonly Namesake[], from: string | undefined, shown: Shown): readonly string[] {
  return namesakes.flatMap((one) => {
    const taken = one.sites.length === 0 ? 'Nothing in this workspace imports it.' : importedIn(one.sites, one.home, name);
    return ['', namesakeLine(name, one), taken, ...kinds(one.sites, from, name, shown, one.home), ...ownLines(one.inFile, name, shown)];
  });
}

/**
 * `Imported in 2 places, all inside @acme/lib.`: the sites of one declaration,
 * counted and split as the headline counts and splits its places, and the ones
 * that may read it said after them.
 */
function importedIn(sites: readonly Site[], home: string | undefined, name: string): string {
  const split = counted(sites, home);
  const count = split.certain.length;
  return `Imported in ${count} ${count === 1 ? 'place' : 'places'}${home === undefined ? '' : spokenSplit(split, home)}.${mayRead(split, name)}`;
}

/** The sites that may read a name and are no use of it, each kind said after the places counted. */
function mayRead({ certain, off, whole }: Counted, name: string): string {
  const reads = certain.length === 0 ? `${off.length} ${off.length === 1 ? 'place reads' : 'places read'}` : `${off.length} more ${off.length === 1 ? 'reads' : 'read'}`;
  const before = certain.length + off.length;
  const passes = before === 0 ? `${whole.length} ${whole.length === 1 ? 'place passes' : 'places pass'}` : `${whole.length} more ${whole.length === 1 ? 'passes' : 'pass'}`;
  return [
    ...(off.length === 0 ? [] : [` ${reads} it off the module's \`default\`, which holds \`${name}\` only when the module is CommonJS.`]),
    ...(whole.length === 0 ? [] : [` ${passes} the module on whole, where this reading does not follow it, and may read \`${name}\`.`]),
  ].join('');
}

/**
 * The lines of each file declaring the name that use it there, which no import
 * names, under that file: a line of one declaring file is another file's name.
 */
function ownLines(inFile: readonly Use[], name: string, shown: Shown): readonly string[] {
  const byFile = new Map<string, Use[]>();
  for (const use of inFile) {
    const lines = byFile.get(use.at);
    if (lines === undefined) byFile.set(use.at, [use]);
    else lines.push(use);
  }
  return [...byFile].flatMap(([at, uses]) => listed(uses, `Used in ${at}, which declares it:`, name, shown));
}

/**
 * The kinds of the declarations the name is published or exported as, as the
 * index holds them, in brackets after the name; nothing when it holds none.
 */
function declaredAs(answer: Answer): string {
  const held = answer.found.length > 0 ? answer.found.map(([, , entry]) => entry.kind) : answer.exported.map((one) => one.declaration);
  return bracketed(held);
}

/**
 * A name its files keep to themselves, the modules inside their reach that
 * import it, as a Rust child module takes its parent's private item with
 * `use super::`, and the lines of the declaring files that use it there.
 */
function keptLines(name: string, kept: readonly DeclaredName[], sites: readonly Site[], inFile: readonly Use[], from: string | undefined, shown: Shown): readonly string[] {
  if (kept.length === 0) return [];
  const taken = sites.length === 0 ? [] : ['', importedIn(sites, packageOf(kept[0]?.by), name), ...kinds(sites, from, name, shown, packageOf(kept[0]?.by))];
  return [keptLine(name, kept, shown.spell), ...taken, ...ownLines(inFile, name, shown)];
}

/**
 * The declarations of a member, then the uses of each one on a named
 * container, nearest first when `from` is said, and the declaration its
 * language's type checker is asked about for the uses no line types.
 */
function memberLines(members: Members, from: string | undefined, name: string, shown: Shown): readonly string[] {
  const nearest = nearestLine(from, shown.spell);
  const used = members.used.flatMap(({ declared, uses }) => {
    if (uses.length === 0) return [];
    const sites = uses.map(({ how: used, ...use }): Site => ({ ...use, by: use.by === '' ? used : `${use.by}, ${used}` }));
    return listed(order(sites, from), `\`${declared.by}.${name}\`, declared at ${declared.at}:${declared.line}, is used in ${places(uses.length)}:`, name, shown);
  });
  // A declaration no line reaches through its type is named once, with the others like it.
  const unused = members.used.filter(({ uses }) => uses.length === 0).map(({ declared }) => `\`${declared.by}\` at ${declared.at}:${declared.line}`);
  const none = unused.length === 0 ? [] : ['', `No line uses \`${name}\` through a value whose type is written as ${unused.join(', ')}.`];
  return [nearest, ...listed(order(members.declared, from), 'Member declarations:', name, shown), ...used, ...none, ...routes(name, members, shown.spell)];
}

/** The imports of an exported name, as `uses` has always answered them. */
function imported(answer: Answer, from: string | undefined, own: readonly string[], shown: Shown): string {
  const { name, found, exported, sites, unread, within, origin, inside } = answer;
  // An export that only passes the name on is followed to the declaration.
  const passed = origin === undefined ? '' : `, which ${passesOn(origin)}`;
  const named = `\`${name}\`${declaredAs(answer)}`;
  // An entry may publish the name only as a member of a namespace it exports.
  const member = inside.length === 0 ? undefined : `published as ${inside.join(' and as ')}`;
  // An answer that covers more than one declaration says which one it counts first.
  // So does one whose door or file spells it by another name than the one asked.
  const { lead } = answer;
  const many = answer.file === undefined && new Set(answer.files).size > 1;
  const declaration = lead !== undefined && (many || renamed(lead, name)) ? publishedAt(lead, name) : undefined;
  const which = declaration === undefined ? '' : `, ${declaration}`;
  const publishedAs = declaration === undefined ? 'published' : `${declaration},`;
  if (sites.length === 0 && exported.length > 0) {
    const how = member === undefined ? `exported, without being published, at ${exportedAt(exported)}` : `${member}, and exported at ${exportedAt(exported)}`;
    return [`${named} is ${how}${passed}, and nothing in this workspace imports it; ${UNCOUNTED}.`, ...own].join('\n');
  }
  if (sites.length === 0 && unread !== undefined) {
    return `${named} is ${publishedAs} and no other package imports it; the imports within its own package are read from the source index, and ${unread}.`;
  }
  if (sites.length === 0) {
    return [`${named} is ${publishedAs} and nothing in this workspace imports it; ${UNCOUNTED}. \`${shown.spell.tool(symbol)}\` has its signature and what is written above it.`, ...own].join('\n');
  }

  const nearest = nearestLine(from, shown.spell);

  // A read off `default` and a module passed on whole are no use of the name: each is listed, as a site that may read it, and counted apart.
  const split = counted(sites, answer.home);
  const certain = split.certain;
  // An `import()` type is a dynamic use that loads nothing.
  const dynamic = certain.filter((use) => use.through?.kind === 'dynamic' && use.type !== true).length;
  const loaded = dynamic === 0 ? '.' : `, ${dynamic} through import(), which loads the module when the call runs.`;
  const may = mayRead(split, name);
  const exportedHere = exported.length > 0 ? `; it is exported at ${exportedAt(exported)}${passed}` : '';
  const published = found.length > 0 ? which : `, ${member ?? 'and no entry publishes it'}${exportedHere}`;
  const taken =
    certain.length === 0
      ? `${named} is imported by name nowhere${published}.`
      : `${named} is imported in ${certain.length} ${certain.length === 1 ? 'place' : 'places'}${answer.home === undefined ? '' : spokenSplit(split, answer.home)}${published}${loaded}`;
  return [
    `${taken}${may}`,
    nearest,
    ...kinds(sites, from, name, shown, answer.home),
    ...own,
    // The imports by package path are in the Help value; the rest are not.
    ...(unread === undefined ? [] : [`\nImports that do not name a package path are not listed: ${unread}.`]),
    ...(within === undefined ? [] : [`\n${UNCOUNTED.charAt(0).toUpperCase()}${UNCOUNTED.slice(1)}.`]),
  ].join('\n');
}

/**
 * The sites of a name, nearest first when `from` is said, stories and tests
 * apart, and each kind's sites from other packages apart from those inside
 * `home`, the package that declares the name, when one is known.
 */
function kinds(sites: readonly Site[], from: string | undefined, name: string, shown: Shown, home: string | undefined): readonly string[] {
  const sorted = order(sites, from);
  return (
    [
      ['story', 'Stories'],
      ['test', 'Tests'],
      ['source', 'Source'],
    ] as const
  ).flatMap(([kind, heading]) => {
    const of = sorted.filter((use) => use.kind === kind);
    if (home === undefined) return listed(of, `${heading}:`, name, shown);
    const { outside, inside } = apart(of, home);
    return [...listed(outside, `${heading}, from other packages:`, name, shown), ...listed(inside, `${heading}, inside ${home}:`, name, shown)];
  });
}
