/**
 * Which words of a sentence are names this workspace publishes or declares,
 * and how they are said: pure functions of the reading and the placements, so
 * a test holding them needs no repository and no index. A word names something
 * only whole: `check` beside `checkoutPath` names nothing. There is no ranking
 * and no model; the dictionary is the reading, and the index for identifiers.
 */

// compass: variance-authority.report.agent-surface

import { everyEntry, kindOf, type Help } from '@variance-authority/package/help';
import { STALE_MAP, unscoped } from './code-map-format.js';
import { specifierOf } from './find.js';
import type { FileDeclarations, RankedArea } from '@variance-authority/sense';
import { narrower, plural, shell } from './format.js';

/**
 * What one word names: a package, one of its entrypoints, a name it exports, a
 * name a file declares, or a file.
 */
export interface Named {
  readonly kind: 'package' | 'entrypoint' | 'export' | 'declared' | 'file';
  /** The package, the entrypoint, the specifier the name is imported from, the declaring file and line as `at:line`, or the file. */
  readonly specifier: string;
  /** For a declaration or a file: the file, without the line. */
  readonly file?: string;
  /** The package it is or is in; for a declaration or a file, the map package nearest at or above it, empty when none is. */
  readonly package: string;
  /** Whether the reading publishes it; a package the map holds may publish nothing, and a declaration or a file is not published. */
  readonly published: boolean;
  /** On the last declaration or file of a word shown: how many more of its kind there are past it. */
  readonly more?: number;
}

/** Where the identifier-shaped words that name nothing published are declared, and which files are named them: at most a few of each, in the order to show them. */
export type Locate = (words: readonly string[], filesOnly?: ReadonlySet<string>) => ReadonlyMap<string, readonly Named[]>;

/** A word that names something, with everything it names: packages first, then entrypoints, then exports. */
export interface Entity {
  readonly word: string;
  readonly names: readonly Named[];
}

export interface Classified {
  /** In the order the asker first wrote each one, each naming only what no earlier word named. */
  readonly entities: readonly Entity[];
  /** The words that name nothing, in the asker's order, each once. */
  readonly plain: readonly string[];
  /** Identifier-shaped words whose source lookup was unavailable, never confirmed nonmatches. */
  readonly unknown?: readonly string[];
}

/** Where a package sits on the code map: its innermost area, absent for one no area took, and its dependency layer. */
export interface Placed {
  readonly area?: { readonly id: string; readonly name: string };
  readonly layer: number;
  /** Its directory from the workspace, as the map's scan drew it; empty for the root. */
  readonly directory: string;
}

/** Every package on the code map, placed, and whether the map was folded from the source index as it stands. */
export interface CodeMapPlaces {
  readonly current: boolean;
  readonly packages: ReadonlyMap<string, Placed>;
  /** Why the map holds no package, when the index was folded into none. */
  readonly unfolded?: string;
}

const ORDER: readonly Named['kind'][] = ['package', 'entrypoint', 'export', 'declared', 'file'];

/**
 * Whether a word is shaped as an identifier rather than a word of prose: one
 * spelled of letters, digits, `_` and `$` alone, with a capital past its first
 * letter, an underscore, or a digit after a letter.
 */
export function identifier(word: string): boolean {
  if (!/^[\p{L}\p{N}_$]+$/u.test(word)) return false;
  return /.\p{Lu}/u.test(word) || word.includes('_') || /\p{L}\p{N}/u.test(word);
}

/**
 * The asker's words: a scoped name, a path and an identifier stay whole, and
 * the punctuation a sentence puts around them is dropped.
 */
export function wordsOf(text: string): readonly string[] {
  return (text.match(/@?[\p{L}\p{N}_$][\p{L}\p{N}_$@./-]*/gu) ?? []).map((word) => word.replace(/[./-]+$/u, ''));
}

/** Every spelling of the mapped packages and of what the reading publishes, keyed by how a word is compared with it. */
function dictionaryOf(help: Help, packages: Iterable<string>): { readonly folded: ReadonlyMap<string, Named[]>; readonly exact: ReadonlyMap<string, Named[]> } {
  const folded = new Map<string, Named[]>();
  const exact = new Map<string, Named[]>();
  const add = (into: Map<string, Named[]>, key: string, named: Named): void => {
    const held = into.get(key) ?? [];
    if (!held.some((one) => one.kind === named.kind && one.specifier === named.specifier)) held.push(named);
    into.set(key, held);
  };
  const publishing = new Set(help.packages.map((published) => published.name));
  for (const owner of packages) {
    const named: Named = { kind: 'package', specifier: owner, package: owner, published: publishing.has(owner) };
    for (const spelled of new Set([owner, unscoped(owner)])) add(folded, spelled.toLowerCase(), named);
  }
  for (const published of help.packages) {
    for (const opening of published.openings) {
      if (opening.subpath === '.') continue;
      const specifier = specifierOf(published, opening);
      for (const spelled of new Set([specifier, unscoped(specifier)])) {
        add(folded, spelled.toLowerCase(), { kind: 'entrypoint', specifier, package: published.name, published: true });
      }
    }
  }
  for (const [published, opening, entry] of everyEntry(help)) {
    add(exact, entry.name, { kind: 'export', specifier: specifierOf(published, opening), file: entry.at, package: published.name, published: true });
  }
  return { folded, exact };
}

/**
 * The words of `text` that are, whole, one of `packages` (scoped or not) or an
 * entrypoint `help` publishes, both without case, or an export it publishes as
 * spelled; or, shaped as an identifier and no package or entrypoint, a name
 * `locate` finds declared or a file it finds named — of an export, only the
 * files, as the export already says where it is declared; and the words that
 * are not.
 */
export function classifyWords(text: string, help: Help, packages: Iterable<string>, locate?: Locate): Classified {
  const { folded, exact } = dictionaryOf(help, packages);
  const words = wordsOf(text);
  const asked = locate === undefined ? [] : [...new Set(words.filter((word) => identifier(word) && !folded.has(word.toLowerCase())))];
  const exported = new Set(asked.filter((word) => exact.has(word)));
  const found = asked.length === 0 || locate === undefined ? new Map<string, readonly Named[]>() : locate(asked, exported);
  const located = new Map([...found].map(([word, names]) => [word, exported.has(word) ? names.filter((named) => named.kind === 'file') : names] as const));
  const entities: Entity[] = [];
  const plain = new Set<string>();
  const listed = new Set<string>();
  for (const word of words) {
    // A package or an entrypoint is matched without case and an export only as
    // spelled, so a word lists only what no earlier word did: `Sense` after
    // `sense` still names an export `Sense`, and names nothing new otherwise.
    // An export is its name in its specifier, so two names one entrypoint
    // exports are two entities.
    const names = [...(folded.get(word.toLowerCase()) ?? []), ...(exact.get(word) ?? []), ...(located.get(word) ?? [])];
    if (names.length === 0) {
      plain.add(word);
      continue;
    }
    const keyOf = (named: Named): string => (named.kind === 'export' || named.kind === 'declared' ? `${named.kind} ${named.specifier} ${word}` : `${named.kind} ${named.specifier}`);
    const fresh = names.filter((named) => !listed.has(keyOf(named)));
    for (const named of fresh) listed.add(keyOf(named));
    // Stable, so `locate`'s order holds within a kind.
    if (fresh.length > 0) entities.push({ word, names: fresh.sort((one, other) => ORDER.indexOf(one.kind) - ORDER.indexOf(other.kind)) });
  }
  return { entities, plain: [...plain] };
}

/** A declaration's or a file's place: the map package it is in, and that package's place, or that it is in none. */
function within(named: Named, packages: ReadonlyMap<string, Placed>): string {
  return named.package === '' ? ' · in no package' : ` · in ${named.package}${where(packages.get(named.package))}`;
}

function where(placed: Placed | undefined): string {
  // A package published since the map was folded; the stale sentence says why.
  if (placed === undefined) return ' · not on the code map';
  const area = placed.area === undefined ? ' · in no area' : ` · area ${placed.area.id} ${placed.area.name}`;
  return `${area} · layer ${placed.layer}`;
}

/** An area of the tree, with the package it sits in when a manifest at or above it names one. */
export type PlacedArea = RankedArea & { readonly package?: string };

/**
 * Each area in the map package whose directory is nearest at or above it,
 * under the name the map gives that package; an area above every package on
 * the map is in none.
 */
export function placedAreas(areas: readonly RankedArea[], packages: ReadonlyMap<string, Placed>): readonly PlacedArea[] {
  const owning = ownerOf(packages);
  return areas.map((area) => {
    const owner = owning(area.path);
    return owner === undefined ? area : { ...area, package: owner };
  });
}

/** The name the map gives the package whose directory is nearest at or above a path, or none when every one is below or beside it. */
export function ownerOf(packages: ReadonlyMap<string, Placed>): (path: string) => string | undefined {
  const owners = [...packages].map(([name, { directory }]) => ({ name, directory: directory === '.' ? '' : directory }));
  return (asked) => {
    const path = asked === '.' ? '' : asked;
    let owner: { readonly name: string; readonly directory: string } | undefined;
    for (const held of owners) {
      const above = held.directory === '' || path === held.directory || path.startsWith(`${held.directory}/`);
      if (above && (owner === undefined || held.directory.length > owner.directory.length)) owner = held;
    }
    return owner?.name;
  };
}

/** The start point the asker said, by the flag that said it. */
export type StartPoint = { readonly from?: readonly string[]; readonly to?: readonly string[] };

/**
 * The entities, one line per thing each names with its place on the code map,
 * then the plain words on one line, then the areas of the tree the words point
 * to, best first, each with its package and that package's place on the map.
 */
export function formatClassified(
  { entities, plain, unknown = [] }: Classified,
  { current, packages, unfolded }: CodeMapPlaces,
  areas: readonly PlacedArea[] = [],
  said: StartPoint = {},
): string {
  const lines: string[] = [];
  if (entities.length > 0) lines.push(`${plural(entities.length, 'word names', 'words name')} a package on the code map, an entrypoint, an exported name, a declared name or a file:`);
  else if (unknown.length === 0) lines.push('No word names a package on the code map, an entrypoint, an exported name, a declared name or a file.');
  lines.push(
    ...entities.flatMap(({ word, names }) =>
      names.flatMap((named, at) => {
        const pad = ' '.repeat(word.length);
        const placed = named.kind === 'declared' || named.kind === 'file' ? within(named, packages) : where(packages.get(named.package));
        const line = `${at === 0 ? word : pad} — ${named.kind} ${named.specifier}${placed}`;
        return named.more === undefined || named.more === 0 ? [line] : [line, `${pad} — and ${named.more} more`];
      }),
    ),
  );
  if (unknown.length > 0) lines.push(`Not looked up: ${unknown.join(' ')}`);
  if (plain.length > 0) lines.push(`Not entities: ${plain.join(' ')}`);
  if (areas.length > 0) {
    lines.push('', 'Areas its words point to, best first:');
    for (const area of areas) {
      const placed = area.package === undefined ? '' : ` · in ${area.package}${where(packages.get(area.package))}`;
      lines.push(`  ${area.path} — ${plural(area.files, 'file')} · holds ${area.words.join(' ')}${placed}`);
    }
  }
  // What each entity is asked next: a word that names a source file nothing, since the
  // file is already the answer, unless a start point was said, which the file may lie
  // outside, and then the named-file block leaves it out; an exported or a declared name is read by `symbol`, a published package or
  // entrypoint counted by `entrypoint`, and a package that publishes nothing
  // placed by `orient` on its area, if one took it.
  const scoped = (said.from?.length ?? 0) > 0 || (said.to?.length ?? 0) > 0;
  const asks = entities.flatMap(({ word, names }) => !scoped && names.some(namesSource) ? [] : names.flatMap((named) => {
    if (named.kind === 'export' || named.kind === 'declared') return [`variance ask symbol --name ${shell(word)}`];
    // A file is itself the place: its package's area would only widen it.
    if (named.kind === 'file') return [];
    if (named.published) return [`variance ask entrypoint --package ${shell(named.specifier)}`];
    const area = packages.get(named.package)?.area;
    return area === undefined ? [] : [`variance ask orient --area ${shell(area.id)}`];
  }));
  // `search` takes the words of one name, so the best area is asked for the
  // two that weigh most there. Directory membership cannot replace a supplied
  // import scope: the area may hold files it never reached. Cross both facts.
  const best = areas.find((area) => area.declares) ?? areas[0];
  if (best !== undefined) {
    const flags = Object.entries(said).flatMap(([which, paths]) => (paths ?? []).map((path) => ` --${which} ${shell(path)}`));
    const from = flags.length > 0 || best.path === '.' || !best.declares ? flags.join('') : ` --from ${shell(best.path)}`;
    const search = `search --query ${shell(best.words.slice(0, 2).join(' '))}${from}`;
    if (scoped && best.path !== '.' && best.declares) {
      const directory = `^${best.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`;
      asks.push(`variance ask intersection ${shell(search)} ${shell(`discover --path ${shell(directory)}`)}`);
    } else asks.push(`variance ask ${search}`);
  }
  lines.push(...narrower([...new Set(asks)]));
  if (unfolded !== undefined) lines.push('', unfolded);
  else if (!current) lines.push('', STALE_MAP);
  return lines.join('\n');
}

/** Whether a name is a tracked source file the word names: a test or a story sharing the word is not what it means. */
function namesSource(named: Named): boolean {
  return named.kind === 'file' && named.file !== undefined && kindOf(named.file) === 'source';
}

/**
 * The files a classified request names, in the order its words name them: the
 * source files a word names, else the first source file that declares it — an
 * export's declaring file, or else the first declarer in the order classify
 * lists them — else the tests and stories it names. Under a start point,
 * `inReach` says which files it reaches, and a file it does not reach is not
 * named.
 */
export function namedFiles({ entities }: Classified, inReach: (file: string) => boolean = () => true): readonly string[] {
  return [...new Set(entities.flatMap(({ names }) => {
    const files = names.flatMap((named) => (named.kind !== 'file' || named.file === undefined || !inReach(named.file) ? [] : [named.file]));
    const sources = files.filter((file) => kindOf(file) === 'source');
    if (sources.length > 0) return sources;
    const first = names.find((named) => (named.kind === 'export' || named.kind === 'declared') && named.file !== undefined && kindOf(named.file) === 'source' && inReach(named.file));
    return first?.file === undefined ? files : [first.file];
  }))];
}

/** The words whose tracked files outnumber the rows classify shows, with how many it left out. */
export function unshownFiles({ entities }: Classified): readonly { readonly word: string; readonly more: number }[] {
  return entities.flatMap(({ word, names }) => {
    const more = names.filter((named) => named.kind === 'file').reduce((sum, named) => sum + (named.more ?? 0), 0);
    return more > 0 ? [{ word, more }] : [];
  });
}

/** The kinds a named file's row lists: what a request names and an answer cites. */
const LISTED_KINDS: ReadonlySet<string> = new Set(['class', 'function']);

/** How many functions and classes of one named file are written out before the rest are counted. */
const LISTED_CAP = 8;

/**
 * The block classify ends with: one row per named file with the functions and
 * classes it declares at its top level, exported first, then by line, under a
 * line saying they are the answer, since a reader handed files and no reason to
 * stop at them answers with their folder. Every file in `asked` gets its row,
 * one `read` holds nothing of or one with nothing to list saying why, and every
 * row says so when `read` is absent, as no index was published; nothing at all
 * when no file is named.
 */
export function formatNamedFiles(
  asked: readonly string[],
  read: readonly FileDeclarations[] | undefined,
  { rest = false, scoped = false, unshown = [] }: { readonly rest?: boolean; readonly scoped?: boolean; readonly unshown?: readonly { readonly word: string; readonly more: number }[] } = {},
): string {
  const held = new Map((read ?? []).map((file) => [file.file, file] as const));
  const rows = asked.map((at) => {
    if (read === undefined) return `  ${at} — no source index was published; \`variance index\` reads it`;
    const file = held.get(at);
    if (file === undefined) return `  ${at} — the source index holds no record of it; \`variance index\` reads it`;
    // Absent is not empty: a file whose declarations were not read may declare anything.
    if (!file.read) return `  ${file.file} — the index holds no parse of its declarations`;
    const listed = file.declarations
      .filter((one) => LISTED_KINDS.has(one.kind))
      .sort((one, other) => Number(other.exported === true) - Number(one.exported === true) || one.line - other.line);
    const past = file.more > 0 ? `; ${plural(file.more, 'more top-level declaration')} past the budget, not read here` : '';
    // Absent is not empty: past the budget, a function or a class may still be declared.
    if (listed.length === 0)
      return file.more > 0
        ? `  ${file.file} — declares no function or class among the top-level declarations read; ${file.more} more past the budget, not read here`
        : `  ${file.file} — declares no function or class at the top level`;
    const kept = listed.slice(0, LISTED_CAP).map((one) => `${one.name}${one.exported === true ? ' (exported)' : ''}`);
    const left = listed.length - kept.length;
    const unknown = file.declarations.some((one) => one.exported === undefined || one.exported === null)
      ? ' (the index kept no exports of it, so none is marked exported)'
      : '';
    return `  ${file.file} — ${kept.join(', ')}${left > 0 ? `, and ${left} more` : ''}${past}${unknown}`;
  });
  return [
    '',
    '',
    `The files the request names, each with the functions and classes it declares, exported first. ${rest ? 'They answer the words that name them, not the rest of the request: a file beside them joins only' : 'They are the answer: a file beside them joins it only'} when it declares a name the request uses, never for sharing their folder.`,
    ...rows,
    ...unshown.map(({ word, more }) => `  and ${plural(more, 'more tracked file')} named \`${word}\`${scoped ? ' across the checkout, reached from the start point or not' : ''}, not read here`),
  ].join('\n');
}
