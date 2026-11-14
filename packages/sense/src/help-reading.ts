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

import { native, nativeRefusal } from './addon.js';
import type { NativeImporters, NativeIndexedUsage } from './native-orient.js';
import type { DeclaredNames, NameTerms } from './declared-names.js';
import { sourceIndexPath } from './source-index.js';
import { CODE_EXTENSIONS } from './language.js';
import type { ResolveOptions } from './resolve.js';
import { withDeclaredTsconfig } from './typescript.js';

type NamedExport = NativeIndexedUsage['exported'][number];

/** One place a name is used, its `through` laid flat: `Use`, and `Taken`'s `name` for an import by path. */
export interface StoreUse {
  readonly by: string;
  readonly at: string;
  readonly line: number;
  readonly type: boolean;
  readonly kind: string;
  readonly local?: string;
  /** `dynamic` or `namespace`; absent for a named import, and the three after it are then unread. */
  readonly through?: string;
  readonly throughLine: number;
  readonly throughDefault: boolean;
  readonly whole: boolean;
  readonly name?: string;
}

/** `Entry`, with its uses as {@link StoreUse}. */
export interface StoreEntry {
  readonly name: string;
  readonly kind: string;
  readonly at: string;
  readonly declared: string;
  readonly line: number;
  readonly signature?: string;
  readonly doc?: string;
  readonly usedBy: readonly string[];
  readonly uses: number;
  readonly sites: readonly StoreUse[];
  readonly throughDefault: readonly StoreUse[];
  readonly mention?: { readonly at: string; readonly line: number; readonly text: string };
}

/** `Documented`, each opening with the specifier a search line prints for it. */
export interface StorePackage {
  readonly name: string;
  readonly entry: boolean;
  readonly openings: readonly {
    readonly subpath: string;
    readonly source: string;
    readonly spec: string;
    readonly entries: readonly StoreEntry[];
    readonly whole: readonly StoreUse[];
  }[];
}

/** `Deep`, with its names as {@link StoreUse}. */
export interface StoreDeep {
  readonly specifier: string;
  readonly by: string;
  readonly at: string;
  readonly line: number;
  readonly to?: string;
  readonly names: readonly StoreUse[];
}

/** A Help value but its export list, laid out as the store's encoder takes it. */
export interface HelpStore {
  readonly packages: readonly StorePackage[];
  readonly deep: readonly StoreDeep[];
  readonly byPath: readonly StoreDeep[];
  readonly unfollowed: readonly StoreDeep[];
  readonly unreadable: readonly string[];
}

/** The generation a store carries in its head, so it cannot describe another checkout. */
export interface StoreMeta {
  readonly root: string;
  readonly graphRoot: string;
  readonly graphDigest: string;
  readonly generatedAt: string;
  /** When the read behind the value began, before any of it was read. */
  readonly readStartedAt: string;
  readonly forwardsDigest?: string;
  readonly indexDigest?: string;
  readonly packagesDigest?: string;
}

/** A store's bytes, and the digest of the export list it was encoded from. */
export interface EncodedStore {
  readonly bytes: Uint8Array;
  readonly exported: string;
}

/** What `HelpReading.publish` writes, beside what the reading holds. */
export interface HelpPublish {
  readonly snapshot: string;
  /** The graph is written at this prefix, its digest and `.bin`. */
  readonly graph: string;
  readonly root: string;
  readonly graphRoot: string;
  readonly generatedAt: string;
  /** When the read behind the value began, before any of it was read. */
  readonly readStartedAt: string;
  /** The digest of the index manifest the reading was made from. */
  readonly indexDigest: string;
  /** What {@link forwardsDigest} states of the reading's `forwards`. */
  readonly forwardsDigest: string;
  /** What the package manifests the value was joined against state, as the store keeps it. */
  readonly packagesDigest: string;
  readonly packages: readonly StorePackage[];
  readonly unreadable: readonly string[];
}

/** The chain's answer for a Help value; the export list stays with the addon. */
export interface HelpReading {
  /** The export list as a set, as `EncodedStore.exported` states it. */
  readonly exportedDigest: string;
  /** The rows of the export list that `files` write; the rest stays with the addon. */
  exportedOf(files: string[]): NativeIndexedUsage['exported'];
  /** The uses and unreadable files, handed over once; `exported`, `deep`, `byPath` and `unfollowed` are empty. */
  usage(): NativeIndexedUsage;
  /** Write the graph and the store; a graph already written under its digest is kept. */
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
  /** The chain at `index`, read and checked once, for the readers below to share. */
  openIndex?(index: string): OpenedIndex;
  readHelp?(root: string, index: string, opened: string[], published: string[], unentered: string[], declared: string[], tsconfig: string | boolean | null, code: string[]): Promise<HelpReading | null>;
  sourceTreeOf?(root: string, index: string, tsconfig: string | boolean | null, code: string[]): Promise<Uint8Array | null>;
  encodeHelpStore?(store: HelpStore, exported: NamedExport[], meta: StoreMeta | null): EncodedStore;
  restampHelpStore?(bytes: Uint8Array, generatedAt: string): Uint8Array;
  digestForwards?(forwards: string[]): string;
  importersOf?(root: string, index: OpenedIndex, files: string[], name: string): NativeImporters | null;
  outsideSourcesOf?(root: string, index: OpenedIndex, name: string): string[] | null;
  memberDeclarationsOf?(root: string, index: OpenedIndex, name: string): MemberDeclarations | null;
  membersOnOf?(index: OpenedIndex, file: string, on: string): ContainerMember[] | null;
  declarationExportedOf?(index: OpenedIndex, file: string, name: string): { readonly declaration?: ExportedDeclaration | null } | null;
  aliasesOf?(root: string, index: OpenedIndex, local: string): Alias[] | null;
  declaredOf?(root: string, index: OpenedIndex, query: string, containing: boolean, files: string[] | null): DeclaredNames | null;
  declaredDescribedOf?(root: string, index: OpenedIndex, query: string, stems: string[], files: string[] | null): DeclaredNames | null;
  declaredTermsOf?(index: OpenedIndex, files: string[] | null): string[] | null;
  nameTerms?(names: string[]): NameTerms;
  declaredLooseOf?(root: string, index: OpenedIndex, groups: string[][], files: string[] | null): DeclaredNames | null;
  /** ripgrep's matching lines of `files` under `root`, as columns; throws `ripgrep refused the pattern: …` for an invalid one. */
  ripgrep?(root: string, pattern: string, files: string[]): Grepped;
}

/** Every matching line, a column per field, and one complaint per file that could not be read. */
export interface Grepped {
  /** The position in the asked list of each hit's file. */
  readonly file: number[];
  readonly line: number[];
  readonly text: string[];
  readonly errors: string[];
}

/**
 * Every line of `files`, relative to `root`, that ripgrep's pattern matches, in
 * the order the files were asked. The search is ripgrep's own crates, linked
 * into the addon, so no `rg` is run.
 */
export function ripgrepNative(root: string, pattern: string, files: readonly string[]): Grepped {
  return entry('ripgrep')(root, pattern, [...files]);
}

/** The addon's `name`, or a refusal that says why the scanner cannot answer. */
export function entry<Name extends keyof NativeHelp>(name: Name): NonNullable<NativeHelp[Name]> {
  const scanner = native() as (NativeHelp & object) | undefined;
  const call = scanner?.[name];
  if (scanner === undefined || call === undefined) {
    throw new Error(`the Help value is read by the native scanner, and ${nativeRefusal() ?? `the scanner that loaded has no \`${name}\`; build it again`}`);
  }
  return (call as (...args: never[]) => unknown).bind(scanner) as NonNullable<NativeHelp[Name]>;
}

/** The source index the addon read and checked once for one question; `close` lets its bytes go. */
export interface OpenedIndex {
  close(): void;
}

/** The indexes the running question opened, by path; `undefined` outside one. */
let question: Map<string, OpenedIndex> | undefined;

/**
 * `ask`, run as one question: each source index the readers here ask during it
 * is read and checked the first time one asks, held while `ask` runs, and closed
 * when it returns. Reading the chain is most of what one reader costs, and an
 * answer about a name declared in ten files asks ten times. Nothing is held
 * between questions, so a question never answers from a chain an index
 * replaced before it began. `ask` is synchronous: no other question can run
 * inside it, and a question asked within it is part of it.
 */
export function asOneQuestion<T>(ask: () => T): T {
  if (question !== undefined) return ask();
  const held = new Map<string, OpenedIndex>();
  question = held;
  try {
    return ask();
  } finally {
    question = undefined;
    for (const opened of held.values()) opened.close();
  }
}

/** `read` over the index at `index` as the running question holds it, or as a question of its own. */
export function onIndex<T>(index: string, read: (opened: OpenedIndex) => T): T {
  return asOneQuestion(() => {
    const held = question!;
    let opened = held.get(index);
    if (opened === undefined) {
      opened = entry('openIndex')(index);
      held.set(index, opened);
    }
    return read(opened);
  });
}

/**
 * The reading of the index at `index` for the entrypoints in `opened`, the
 * imports into the packages in `targets.published` that no entry opens, the
 * packages in `targets.unentered`, which declare no entry, and the specifiers
 * in `targets.declared`, which a manifest names whether or not the reading
 * could follow them; `null` when none was published. `opened` and
 * `targets.declared` are `<package> .<subpath>` keys. Its graph carries what
 * each test loads for real beside its mocks, resolved under the `tsconfig` the
 * repository declares, as `mockTaint` joins them.
 */
export function readHelp(
  root: string,
  opened: readonly string[],
  targets: { readonly published: Iterable<string>; readonly unentered: Iterable<string>; readonly declared: Iterable<string> },
  index: string = sourceIndexPath(root),
): Promise<HelpReading | null> {
  return entry('readHelp')(root, index, [...opened], [...targets.published], [...targets.unentered], [...targets.declared], ...mocking(root));
}

/**
 * The source tree `readHelp` publishes for the index at `index`, for a reading
 * whose usage was drawn on this side; `null` when none was published.
 */
export function sourceTreeOf(root: string, index: string = sourceIndexPath(root)): Promise<Uint8Array | null> {
  return entry('sourceTreeOf')(root, index, ...mocking(root));
}

/** How a test's loads beside its mocks resolve: the `tsconfig` the repository declares, and the extensions read as code. */
function mocking(root: string): [string | boolean | null, string[]] {
  const { tsconfig } = withDeclaredTsconfig<ResolveOptions>(root, {});
  return [tsconfig ?? null, [...CODE_EXTENSIONS]];
}

/** The store of `store` and `exported`, stamped with `meta` when it is published, and the digest of `exported`. */
export function encodeHelpStore(store: HelpStore, exported: readonly NamedExport[], meta?: StoreMeta): EncodedStore {
  return entry('encodeHelpStore')(store, [...exported], meta ?? null);
}

/** The same store with a new `generatedAt`: the body is copied as it is. */
export function restampHelpStore(bytes: Uint8Array, generatedAt: string): Uint8Array {
  return entry('restampHelpStore')(bytes, generatedAt);
}

/** The `export … from` rows of a reading as a set, which the export list does not hold. */
export function forwardsDigest(forwards: readonly string[]): string {
  return entry('digestForwards')([...forwards]);
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
  return onIndex(index, (opened) => entry('importersOf')(root, opened, [...files], name)) ?? undefined;
}

/**
 * Every specifier, as written and in code-unit order, that names a package or
 * a runtime module the index at `index` resolved to no file, and out of which
 * an import takes `name`; `undefined` when no index was published. Throws
 * when the index does not read.
 */
export function outsideSourcesOf(root: string, name: string, index: string = sourceIndexPath(root)): readonly string[] | undefined {
  return onIndex(index, (opened) => entry('outsideSourcesOf')(root, opened, name)) ?? undefined;
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
  return onIndex(index, (opened) => entry('memberDeclarationsOf')(root, opened, name)) ?? undefined;
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
  return onIndex(index, (opened) => entry('membersOnOf')(opened, file, on)) ?? undefined;
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
  const read = onIndex(index, (opened) => entry('declarationExportedOf')(opened, file, name));
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
  return onIndex(index, (opened) => entry('aliasesOf')(root, opened, local)) ?? undefined;
}
