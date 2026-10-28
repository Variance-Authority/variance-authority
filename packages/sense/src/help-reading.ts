/**
 * The Help value's reading of the source index, held by the addon.
 *
 * On a large repository the value is mostly its export list — every export of
 * every file — and handing that list across as objects cost more than
 * everything done with it. So the reading keeps the list, and the path graph,
 * on the addon's side: JavaScript takes the uses it joins against the
 * documented surface, compares the list by its digest, and asks the reading to
 * publish. The search is encoded by the same code for a value JavaScript
 * already holds, which hands its list across once.
 */

// compass: variance-authority.report.agent-surface

import { native, nativeRefusal } from './native.js';
import { BUILTINS } from './native-index-graph.js';
import type { NativeImporters, NativeIndexedUsage, NativeNameUse } from './native-orient.js';
import type { SourceSymbolReach } from './harvest.js';
import { sourceIndexPath } from './source-index.js';

type NamedExport = NativeIndexedUsage['exported'][number];

/** The published rows of a Help value, a column per field, in `everyEntry` order. */
export interface PublishedRows {
  readonly name: string[];
  /** `specifierOf` the row's package and opening. */
  readonly spec: string[];
  readonly kind: string[];
  readonly doc: (string | null)[];
  readonly at: string[];
  readonly usedBy: number[];
  readonly uses: number[];
  /** How many sites each row has; their files follow in `sites`, row by row. */
  readonly siteCounts: number[];
  readonly sites: string[];
}

/** The published generation a search file carries in its head, so it cannot describe another checkout. */
export interface SearchGeneration {
  readonly root: string;
  readonly graphRoot: string;
  readonly graphDigest: string;
  readonly generatedAt: string;
}

/** A search file's bytes, and the digest of the export list it was encoded from. */
export interface EncodedSearch {
  readonly bytes: Uint8Array;
  readonly exported: string;
}

/** What `HelpReading.publish` writes, beside what the reading holds. */
export interface HelpPublish {
  readonly snapshot: string;
  readonly search: string;
  /** The graph is written at this prefix, its digest and `.bin`. */
  readonly graph: string;
  readonly format: string;
  readonly version: number;
  readonly root: string;
  readonly graphRoot: string;
  readonly generatedAt: string;
  /** The digest of the index manifest the reading was made from. */
  readonly indexDigest: string;
  /** JSON of the value's `packages`, `deep`, `byPath`, `unfollowed` and `unreadable`. */
  readonly packages: string;
  readonly deep: string;
  readonly byPath: string;
  readonly unfollowed: string;
  readonly unreadable: string;
  readonly published: PublishedRows;
}

/** The chain's answer for a Help value; the export list stays with the addon. */
export interface HelpReading {
  /** The export list as a set, as `EncodedSearch.exported` states it. */
  readonly exportedDigest: string;
  /** The uses, deep requests and unreadable files, handed over once; `exported` is empty. */
  usage(): NativeIndexedUsage;
  /** Write the graph, the value and its search; a graph already written under its digest is kept. */
  publish(options: HelpPublish): Promise<{ readonly graphDigest: string }>;
}

/** One declaration of a member, `on` the interface, type alias or class that holds it. */
export interface MemberSite {
  readonly at: string;
  readonly line: number;
  /** The package of the file, or empty when no package holds it. */
  readonly by: string;
  readonly kind: 'source' | 'story' | 'test';
  /** The container's name, or `a type literal` or `a class` when it has none. */
  readonly on: string;
  /**
   * Every line that uses the member through a value whose type is written as
   * the container, by file in code units, then by line; absent for a
   * container with no name, which no line can write.
   */
  readonly uses?: readonly MemberUseSite[];
}

/** The declarations of a member by one name, and the extensions of the files the index holds. */
export interface MemberDeclarations {
  readonly sites: readonly MemberSite[];
  readonly extensions: readonly string[];
}

/** One member a container declares: its name and its line. */
export interface ContainerMember {
  readonly name: string;
  readonly line: number;
}

/**
 * The declaration an export binds: the file that declares it, the name it has
 * there, its line and kind, and the spans of its signature and doc comment in
 * the file's UTF-16 offsets, when the parser kept them.
 */
export interface ExportedDeclaration {
  readonly at: string;
  readonly name: string;
  readonly line: number;
  /** As the parser harvested it: `function`, `const`, … */
  readonly kind: string;
  readonly signatureStart?: number | null;
  readonly signatureEnd?: number | null;
  readonly docStart?: number | null;
  readonly docEnd?: number | null;
}

/** One line that uses a member, and how. */
export interface MemberUseSite {
  readonly at: string;
  readonly line: number;
  /** The package of the file, or empty when no package holds it. */
  readonly by: string;
  readonly kind: 'source' | 'story' | 'test';
  readonly how: 'destructure' | 'implement' | 'read' | 'write';
}

/** One import that binds a local name to an export of another name. */
export interface Alias {
  /** The importing file, and the line of its import statement. */
  readonly at: string;
  readonly line: number;
  /** The package of the importing file, or empty when no package holds it. */
  readonly by: string;
  readonly kind: 'source' | 'story' | 'test';
  /** The export name the binding takes, `default` for a default import. */
  readonly imported: string;
  /** The specifier as the importing file wrote it. */
  readonly specifier: string;
  /** The file the index resolved the specifier to, when it resolved. */
  readonly to?: string | null;
  readonly type: boolean;
}

export interface NativeHelp {
  readHelp?(root: string, index: string, opened: string[], published: string[], unentered: string[], declared: string[]): Promise<HelpReading | null>;
  encodeSearchIndex?(published: PublishedRows, exported: NamedExport[], generation: SearchGeneration | null): EncodedSearch;
  digestExported?(exported: NamedExport[]): string;
  importersOf?(root: string, index: string, files: string[], name: string): NativeImporters | null;
  outsideImportersOf?(root: string, index: string, name: string, builtins: readonly string[]): OutsideImports | null;
  memberDeclarationsOf?(root: string, index: string, name: string): MemberDeclarations | null;
  membersOnOf?(index: string, file: string, on: string): ContainerMember[] | null;
  declarationExportedOf?(index: string, file: string, name: string): { readonly declaration?: ExportedDeclaration | null } | null;
  aliasesOf?(root: string, index: string, local: string): Alias[] | null;
  declaredOf?(root: string, index: string, query: string, containing: boolean, files: string[] | null): DeclaredNames | null;
  declaredDescribedOf?(root: string, index: string, query: string, stems: string[], files: string[] | null): DeclaredNames | null;
  declaredTermsOf?(index: string, files: string[] | null): string[] | null;
  declaredLooseOf?(root: string, index: string, groups: string[][], files: string[] | null): DeclaredNames | null;
}

function entry<Name extends keyof NativeHelp>(name: Name): NonNullable<NativeHelp[Name]> {
  const scanner = native() as (NativeHelp & object) | undefined;
  const call = scanner?.[name];
  if (scanner === undefined || call === undefined) {
    throw new Error(`the Help value is read by the native scanner, and ${nativeRefusal() ?? `the scanner that loaded has no \`${name}\`; build it again`}`);
  }
  return (call as (...args: never[]) => unknown).bind(scanner) as NonNullable<NativeHelp[Name]>;
}

/**
 * The reading of the index at `index` for the entrypoints in `opened`, the
 * imports into the packages in `targets.published` that no entry opens, the
 * packages in `targets.unentered`, which declare no entry, and the specifiers
 * in `targets.declared`, which a manifest names whether or not the reading
 * could follow them; `null` when none was published. `opened` and
 * `targets.declared` are `<package> .<subpath>` keys.
 */
export function readHelp(
  root: string,
  opened: readonly string[],
  targets: { readonly published: Iterable<string>; readonly unentered: Iterable<string>; readonly declared: Iterable<string> },
  index: string = sourceIndexPath(root),
): Promise<HelpReading | null> {
  return entry('readHelp')(root, index, [...opened], [...targets.published], [...targets.unentered], [...targets.declared]);
}

/** The search over `published` and `exported`, and the digest of `exported`. */
export function encodeSearch(published: PublishedRows, exported: readonly NamedExport[], generation?: SearchGeneration): EncodedSearch {
  return entry('encodeSearchIndex')(published, [...exported], generation ?? null);
}

/** The digest `HelpReading.exportedDigest` states, of a list JavaScript holds. */
export function exportedDigest(exported: readonly NamedExport[]): string {
  return entry('digestExported')([...exported]);
}

/**
 * Every import of `name` out of one of `files`, repo-relative, by any file the
 * index at `index` holds — an import within a package as well as one across
 * packages, which the Help value does not record — ordered by the importing
 * file in code units, then by line; `undefined` when no index was published.
 * A file that passes the name on with `export … from` is followed under the
 * name it exports and named in `through`, and is no use. Each use's `key` is
 * the specifier as the importing file wrote it, and its `name` the name it
 * takes, which such a file can rename. Throws when the index does not read.
 */
export function importersOf(
  root: string,
  files: readonly string[],
  name: string,
  index: string = sourceIndexPath(root),
): NativeImporters | undefined {
  return entry('importersOf')(root, index, [...files], name) ?? undefined;
}

/** One import of a name out of an installed package. */
export interface OutsideUse {
  /** The package the specifier names, or the runtime's module with its `node:` scheme, such as `node:path`. */
  package: string;
  /** The module is the runtime's, not a package the workspace installs. */
  runtime: boolean;
  /** The request is an `export … from`, which passes the name on. */
  passesOn: boolean;
  site: NativeNameUse;
}

/** Every import of a name from outside a workspace, and the files whose imports were not read. */
export interface OutsideImports {
  uses: OutsideUse[];
  /** Files the index holds whose imports do not read, in code-unit order; any of them may import the name. */
  unread: string[];
}

/**
 * Every import of `name` from outside the workspace, by any file the index at
 * `index` holds: a request the scan did not resolve to a file, out of a package
 * no manifest of the workspace declares, the rule the external-dependency
 * orientation keeps, or out of a module named in Node's `builtinModules`, with
 * or without `node:`. `export … from` counts,
 * `export *` does not; `key` is the specifier as written. `undefined` when no
 * index was published; throws when it does not read.
 */
export function outsideImportersOf(root: string, name: string, index: string = sourceIndexPath(root)): OutsideImports | undefined {
  return entry('outsideImportersOf')(root, index, name, BUILTINS) ?? undefined;
}

/**
 * Every declaration of a member named `name` the index at `index` records: a
 * property or method signature, a class method, property or accessor, or a
 * constructor parameter property, each on its interface, type alias or class.
 * The scan records them with each file's parse, for the languages
 * `readsMembers` names, so beside them are the distinct extensions of the
 * files the index holds, dot included, in code units, which `languageOf`
 * names. Ordered by file in code units, then by line; `undefined` when no
 * index was published. Throws when the index does not read.
 */
export function memberDeclarationsOf(root: string, name: string, index: string = sourceIndexPath(root)): MemberDeclarations | undefined {
  return entry('memberDeclarationsOf')(root, index, name) ?? undefined;
}

/**
 * Every member the interface, type alias or class named `on` declares in
 * `file`, repo-relative, by line, as the newest parse the index at `index`
 * holds of the file records them: a property or method signature, a class
 * method, property or accessor, or a constructor parameter property. A member
 * of a type literal inside the container is the literal's. `undefined` when no
 * index was published; throws when the index does not read.
 */
export function membersOn(root: string, file: string, on: string, index: string = sourceIndexPath(root)): readonly ContainerMember[] | undefined {
  return entry('membersOnOf')(index, file, on) ?? undefined;
}

/**
 * The declaration the export `name` of `file`, repo-relative, binds: the
 * file's own, under its own name or another, or the one it passes on through
 * every `export … from` and every import a file exports again between
 * them, renamed or not and type-only or not, and through an `export *` when no
 * named export passes the name, as ECMAScript resolves an export: a file's own
 * export list first, then a named `export … from`, then its stars, none of
 * which passes `default`. `null` when the walk ends short of a declaration:
 * at a namespace (`export * as`, `import * as`), at a request that resolved
 * to no file of the checkout, at a file with no export list in the index that
 * does not declare the name, back at a file it passed through, or at stars that reach different declarations.
 * `undefined` when no index was published; throws when the index does not
 * read.
 */
export function declarationExported(root: string, file: string, name: string, index: string = sourceIndexPath(root)): ExportedDeclaration | null | undefined {
  const read = entry('declarationExportedOf')(index, file, name);
  return read === null ? undefined : (read.declaration ?? null);
}

/**
 * Every import the index at `index` holds that binds `local` to an export of
 * another name — `import { stringReader as openStrings }` for `openStrings` —
 * ordered by the importing file in code units, then by line; `undefined` when
 * no index was published. The binding the parse recorded is what ties the two
 * names. A namespace import and a binding an `export … from` writes are left
 * out. Throws when the index does not read.
 */
export function aliasesOf(root: string, local: string, index: string = sourceIndexPath(root)): readonly Alias[] | undefined {
  return entry('aliasesOf')(root, index, local) ?? undefined;
}

/** One top-level declaration no export of its file binds. */
export interface DeclaredName {
  readonly name: string;
  /** The declaration's kind as the parser harvested it: `function`, `const`, … */
  readonly kind: string;
  readonly at: string;
  /** The package whose source it is; empty at the repository root. */
  readonly by: string;
  readonly line: number;
  /** `source`, `test` or `story`, as `kindOf` says of the file. */
  readonly fileKind: 'source' | 'test' | 'story';
  /** The signature's span in the file's UTF-16 offsets, when the parser kept one. */
  readonly signatureStart?: number | null;
  readonly signatureEnd?: number | null;
  /** The doc comment's span, inside its opening and closing marks, when one is written above. */
  readonly docStart?: number | null;
  readonly docEnd?: number | null;
  /** Who can name it, as the reader of its language recorded; absent when the reader cannot tell. */
  readonly reach?: SourceSymbolReach | null;
  /** Asked by `declaredDescribedOf`: the positions, ascending, of the asked stems its name or doc holds. */
  readonly held?: readonly number[] | null;
  /** Asked by `declaredDescribedOf`: the positions, ascending, of those its name holds. */
  readonly named?: readonly number[] | null;
  /** Asked by `declaredDescribedOf`: how many of the question's adjacent word pairs its doc writes adjacent. */
  readonly near?: number | null;
  /** Asked by `declaredDescribedOf`: the bytes of the doc the words were held against, its lines joined by single spaces; absent when it writes none. */
  readonly docLength?: number | null;
  /** The name of the function whose body declares it, when that function has one. */
  readonly holder?: string | null;
  /** The line the function whose body declares it starts on: present only for a declaration inside a function. */
  readonly holderLine?: number | null;
}

/** A file a description reached by its own name and the doc it opens with. */
export interface DescribedFile {
  readonly at: string;
  /** The package whose source it is; empty at the repository root. */
  readonly by: string;
  /** The module doc's span, inside its marks, when the file opens with one. */
  readonly docStart?: number | null;
  readonly docEnd?: number | null;
  /** The positions, ascending, of the asked stems its name or its module doc holds. */
  readonly held: readonly number[];
  /** The positions, ascending, of those its name holds. */
  readonly named: readonly number[];
  /** How many of the question's adjacent word pairs its module doc writes adjacent. */
  readonly near: number;
  /** The bytes of the module doc the words were held against, its lines joined by single spaces; absent when it writes none. */
  readonly docLength?: number | null;
}

/** What `declaredOf` found, and the files whose declarations it could not read. */
export interface DeclaredNames {
  /** Ordered by file in code units, then by line. */
  readonly names: readonly DeclaredName[];
  /** Files whose declarations were not read — no parse, or one its reader did not harvest: unknown, not empty. */
  readonly unread: readonly string[];
  /** Asked by `declaredDescribedOf`: the files whose name and module doc hold any of the question; empty otherwise. */
  readonly files: readonly DescribedFile[];
}

/**
 * Every top-level declaration the index at `index` holds that no export of its
 * file binds — the names a file keeps to itself, which no export list holds —
 * named `query` exactly, or, given `containing`, whose name or doc comment
 * holds it in any case; only in `files`, repo-relative, when they are named. A name declared
 * twice in one file is answered once. `undefined` when no index was
 * published; throws when the index does not read.
 */
export function declaredOf(
  root: string,
  query: string,
  options: { readonly containing?: boolean; readonly files?: Iterable<string> } = {},
  index: string = sourceIndexPath(root),
): DeclaredNames | undefined {
  const containing = options.containing === true;
  const files = options.files === undefined ? null : [...options.files];
  return entry('declaredOf')(root, index, containing ? query.toLowerCase() : query, containing, files) ?? undefined;
}

/**
 * Every top-level declaration the index at `index` holds that no export of its
 * file binds, whose name and doc comment, cut into stems by the rule
 * `describedWordsNative` cuts `query` by, hold any of `stems`, in any
 * order; only in `files`, repo-relative, when they are named.
 * Each carries the positions of the stems it holds, how many its name holds,
 * and how many of the question's adjacent word pairs its doc writes adjacent.
 * Beside them, the files whose name and module doc hold any, the same way.
 * `undefined` when no index was published; throws when the index does not read.
 */
export function declaredDescribedOf(
  root: string,
  query: string,
  stems: readonly string[],
  files?: Iterable<string>,
  index: string = sourceIndexPath(root),
): DeclaredNames | undefined {
  return entry('declaredDescribedOf')(root, index, query, [...stems], files === undefined ? null : [...files]) ?? undefined;
}

/**
 * The distinct search terms of every top-level name the index at `index`
 * harvested, cut as the search file cuts an exported name, in `files` when they
 * are named, sorted by their UTF-8 bytes as the search file's dictionary is.
 * `undefined` when no index was published; throws when the index does not read.
 */
export function declaredTermsOf(root: string, files?: Iterable<string>, index: string = sourceIndexPath(root)): readonly string[] | undefined {
  return entry('declaredTermsOf')(index, files === undefined ? null : [...files]) ?? undefined;
}

/**
 * Every top-level declaration the index at `index` holds that no export of its
 * file binds, whose name's terms hold one of every group of `groups`: the
 * terms the loose pass let each word of a question stand for. `undefined` when
 * no index was published; throws when the index does not read.
 */
export function declaredLooseOf(
  root: string,
  groups: readonly (readonly string[])[],
  files?: Iterable<string>,
  index: string = sourceIndexPath(root),
): DeclaredNames | undefined {
  return entry('declaredLooseOf')(root, index, groups.map((group) => [...group]), files === undefined ? null : [...files]) ?? undefined;
}
