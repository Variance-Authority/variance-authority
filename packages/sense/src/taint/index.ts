/**
 * `@variance-authority/sense/taint` — a second table of imports, joined onto
 * the scan's.
 *
 * The scan writes down what a file's text says it imports. That is true and it
 * is not the whole truth. A test that calls `vi.mock('./api')` imports `./api`
 * by the letter and never runs a line of it; a `jsresource('./panel')` in a
 * Relay component names a module in a notation no parser has heard of and runs
 * every line of it. Both are facts about the file that the file does not state
 * in a form `oxc` returns, and they arrive from somewhere else — a test runner
 * convention, a framework, a person who knows.
 *
 * ## A taint is a parallel table, not a patched record
 *
 * Every taint produces an {@link ImportDiff} per file: specifiers the file does
 * **not** import despite writing them, and specifiers it **does** import
 * without writing them. The scan's records are left as they were read, the
 * parse cache and record cache keep what they held, and the diff is joined on
 * afterwards by file path ({@link taintRecords}). Two consequences follow. A
 * user can ship a taint as a JSON file next to the repository and never touch
 * the scan ({@link taintFile}). And the same records can be viewed under
 * several taints at once, or none, without a second walk — the join is the
 * only thing that changes ([ADR-0041](../../../../docs/context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)).
 *
 * ## A plus is an edge, a minus is a node
 *
 * The two halves of a diff land in different places, because they are facts of
 * different shape. An addition is an import the file makes: one more edge on
 * the file's record, resolved the way the scan resolves any other. A removal is
 * not the absence of one edge. `vi.mock('./api')` replaces `api.ts` for the
 * whole of that test's run — for the test, for the component it imports, for
 * anything under it — so it is the module taken out of the graph as seen from
 * that file, at every level. That is a row in {@link Tainted.shadows}, keyed by
 * the file and naming the files it never reaches, and `movedBy` in
 * `core/relate` consults it: a file is moved by a change only when some trail
 * from the change arrives without crossing one of its shadows.
 *
 * ## A plus the scan never walked to
 *
 * An addition can name a file outside the scanned directories, and then the
 * graph gains a node nobody read. A node with no edges of its own reads as *a
 * file that imports nothing*, and the truth is *nobody looked* — the absence
 * the graph must never spell as an empty set
 * ([ADR-0002](../../../../docs/context/adr/0002-observation-profiles.md)). So
 * such a file arrives with {@link FileRecord.unknown} set, which is what the
 * scan already does for a file it could not read: its edges are unavailable,
 * the graph treats it as possibly depending on anything, and it widens a
 * selection rather than narrowing one.
 *
 * The other honest answer — queue the file and read it — is the one this does
 * not take, because it would make the scan's output depend on which taints were
 * applied. The records, the parse cache and the record cache would no longer be
 * the untainted scan, the same records could no longer be viewed under several
 * taints at once, and the file read that way could itself carry a taint naming
 * another unscanned file, so the join would have to run to a fixed point. A
 * caller that wants those files read has a direct way to say so: name their
 * directory in the scan.
 *
 * ## Composition, and whose word it was
 *
 * Under more than one taint the removals are unioned and so are the additions.
 * The two never contend: an edge one taint adds to a file another taint shadows
 * is an edge into a node the file's run never enters, and the shadow holds, the
 * way the mock holds at runtime. The union keeps its sources — a target cut by
 * two taints is credited to both, in {@link Tainted.shadowedBy} — because a run
 * that leaves a test out of a selection owes the operator the name of what cut
 * it, and a hand-written table and a mock reader are answerable in different
 * ways.
 *
 * ## What a second run costs
 *
 * A reader's answer is a pure function of the file's bytes and the reader
 * asking, so {@link TaintOptions.cache} holds it under a digest over both
 * ([`cache.ts`](./cache.ts)). With one, an unchanged file costs two map lookups
 * per reader and is neither opened nor parsed; without one, it is opened once
 * and parsed at most once however many readers ask about it.
 */

// compass: variance-authority.reach

import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import { parseSync, rawTransferSupported, type ParserOptions } from 'oxc-parser';
import type { ParseCache } from '../cache.js';
import type { Digest } from '../digest.js';
import type { Node } from '../instrument/blocks.js';
import { MODULE_EXTENSIONS } from '../read.js';
import { realPath, resolversFor, type ResolveOptions } from '../resolve.js';
import { rememberDiff, rememberedDiff } from './cache.js';
import { applied, byCodeUnit, reach, targetFrom, type Said } from './join.js';

export type { Node };

/** What one file imports beyond, or short of, what its text says. */
export interface ImportDiff {
  /** Specifiers the file writes and never reaches, at any depth of its run. */
  readonly minus?: readonly string[];
  /** Specifiers the file imports and does not write, exactly as it would have written them. */
  readonly plus?: readonly string[];
}

/** One file, handed to a taint that reads files. */
export interface TaintSubject {
  /** Repository-relative. */
  readonly file: string;
  readonly source: string;
  /** The parsed tree, produced on first call and kept. */
  program(): Node;
}

/**
 * One source of import diffs.
 *
 * A static table, a reader over the file's text, or both. A reader is asked
 * about every module file under `files`, and about every module file when
 * `files` is absent — which means opening each one, so a reader that only ever
 * finds something in test files should say so.
 */
export interface Taint {
  /** For the report, and for the cache key. Two taints with one name are one taint twice. */
  readonly name: string;
  /** Diffs by repository-relative file path. */
  readonly diffs?: ReadonlyMap<string, ImportDiff>;
  /** Which files `read` is asked about. Every module file when absent. */
  readonly files?: (file: string) => boolean;
  /** A diff read off the file itself. */
  readonly read?: (subject: TaintSubject) => ImportDiff | undefined;
}

export interface TaintOptions extends ResolveOptions {
  /** Repository root. Every path in the records is relative to it. */
  readonly root: string;

  /**
   * Where readers' answers are remembered, by file digest and taint name.
   *
   * The scan's parse cache serves, and sharing it is the point: one store, one
   * save, one pruning rule. A file whose record carries no digest names no
   * bytes and is read every time.
   */
  readonly cache?: ParseCache;
}

/** The records with the additions joined on, and the tables beside them. */
export interface Tainted {
  /**
   * One per input, in order; a record no taint adds to is the same object.
   *
   * After them, one record per file an addition reached that the scan never
   * walked to, each carrying `unknown` rather than an empty edge list.
   */
  readonly records: readonly FileRecord[];
  /**
   * Per file, the resolved files its run never reaches. The table `movedBy`
   * takes as `shadows`. A removal that resolves to nothing names no node and
   * cuts nothing.
   */
  readonly shadows: ReadonlyMap<string, readonly string[]>;
  /** Per file, the resolved files its additions reached. For the audit and the report. */
  readonly additions: ReadonlyMap<string, readonly string[]>;
  /** Per file, per shadowed file, the taints that said so. Sorted, and unioned over taints. */
  readonly shadowedBy: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
  /** Per file, per added file, the taints that said so. */
  readonly addedBy: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

/** The table a JSON taint file holds: a diff per file, `-` and `+` as keys. */
export type TaintTable = Readonly<
  Record<string, { readonly '-'?: readonly string[]; readonly '+'?: readonly string[] }>
>;

const TRANSFER = { experimentalRawTransfer: rawTransferSupported() } as ParserOptions;

/**
 * The records with every taint's additions joined on, and the shadows beside.
 *
 * Records come back in the order they arrived, one per input, and a record no
 * taint adds to is the same object. An added specifier that resolves to
 * nothing lands where the scan would have put it — `unresolved`, and `unknown`
 * when it is relative, because a taint that names a path inside the repository
 * and misses is the same hole a file naming one is. One that resolves to a file
 * the scan never walked to brings that file with it, `unknown` and edgeless.
 */
export async function taintRecords(
  records: readonly FileRecord[],
  taints: readonly Taint[],
  options: TaintOptions,
): Promise<Tainted> {
  const shadows = new Map<string, readonly string[]>();
  const additions = new Map<string, readonly string[]>();
  const shadowedBy = new Map<string, ReadonlyMap<string, readonly string[]>>();
  const addedBy = new Map<string, ReadonlyMap<string, readonly string[]>>();
  if (taints.length === 0) return { records, shadows, additions, shadowedBy, addedBy };

  const root = realPath(resolve(options.root));
  const resolvers = resolversFor(options);
  const readers = taints.filter((taint) => taint.read !== undefined);
  const scanned = new Set(records.map((record) => record.file));
  const unwalked = new Set<string>();
  const joined: FileRecord[] = [];

  for (const record of records) {
    const said = await saidOf(record, root, taints, readers, options.cache);
    if (said === undefined) {
      joined.push(record);
      continue;
    }
    const target = targetFrom(record.file, root, resolvers);
    const cut = reach(said.minus, target);
    if (cut.targets.length > 0) {
      shadows.set(record.file, cut.targets);
      shadowedBy.set(record.file, cut.by);
    }
    if (said.plus.size === 0) {
      joined.push(record);
      continue;
    }
    const added = reach(said.plus, target);
    joined.push(applied(record, added));
    if (added.targets.length > 0) {
      additions.set(record.file, added.targets);
      addedBy.set(record.file, added.by);
      for (const to of added.targets) if (!scanned.has(to)) unwalked.add(to);
    }
  }

  for (const file of [...unwalked].sort(byCodeUnit)) {
    joined.push({
      file,
      unknown: `${file} is named by a taint addition and is outside the scanned directories: nothing read it, so its own imports are unknown`,
    });
  }

  return { records: joined, shadows, additions, shadowedBy, addedBy };
}

/** A taint from a table already in memory. */
export function taintTable(name: string, table: TaintTable): Taint {
  const diffs = new Map<string, ImportDiff>();
  for (const [file, row] of Object.entries(table)) {
    diffs.set(file, {
      ...(row['-'] === undefined ? {} : { minus: row['-'] }),
      ...(row['+'] === undefined ? {} : { plus: row['+'] }),
    });
  }

  return { name, diffs };
}

/**
 * A taint from a JSON file: `{ "src/a.test.ts": { "-": ["./b"], "+": ["./c"] } }`.
 *
 * Named after the file, so a report that says which taint cut an edge names
 * something a person can open. A file that is not there or not that shape is
 * an error and not an empty taint: a taint the user pointed at and that
 * contributed nothing would be a silent return to the untainted graph.
 */
export async function taintFile(path: string): Promise<Taint> {
  const text = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a taint table: expected an object keyed by file path`);
  }

  return taintTable(path, parsed as TaintTable);
}

/** Every specifier every taint named for one file, each with the taints that named it. */
interface Sides {
  readonly minus: Said;
  readonly plus: Said;
}

async function saidOf(
  record: FileRecord,
  root: string,
  taints: readonly Taint[],
  readers: readonly Taint[],
  cache: ParseCache | undefined,
): Promise<Sides | undefined> {
  const minus = new Map<string, Set<string>>();
  const plus = new Map<string, Set<string>>();
  const file = record.file;

  const fold = (name: string, diff: ImportDiff | undefined): void => {
    for (const value of diff?.minus ?? []) add(minus, value, name);
    for (const value of diff?.plus ?? []) add(plus, value, name);
  };

  for (const taint of taints) fold(taint.name, taint.diffs?.get(file));

  const asked = readers.filter(
    (taint) => MODULE_EXTENSIONS.includes(extname(file)) && (taint.files?.(file) ?? true),
  );
  await readEach(asked, record, root, cache, fold);

  return minus.size === 0 && plus.size === 0 ? undefined : { minus, plus };
}

/**
 * Every reader asked about one file, over one read and at most one parse.
 *
 * A reader whose answer is already in the cache is not asked, and a file whose
 * readers are all answered is not opened — which is the whole saving, because
 * opening is what a scan of ten thousand files was arranged to avoid.
 */
async function readEach(
  asked: readonly Taint[],
  record: FileRecord,
  root: string,
  cache: ParseCache | undefined,
  fold: (name: string, diff: ImportDiff | undefined) => void,
): Promise<void> {
  const digest: Digest | undefined = record.digest;
  const pending: Taint[] = [];

  for (const taint of asked) {
    const remembered = rememberedDiff(cache, digest, taint.name);
    if (remembered === undefined) pending.push(taint);
    else fold(taint.name, remembered);
  }
  if (pending.length === 0) return;

  const subject = await subjectFor(record.file, root);
  if (subject === undefined) return;
  for (const taint of pending) {
    const diff = taint.read!(subject);
    rememberDiff(cache, digest, taint.name, diff);
    fold(taint.name, diff);
  }
}

/** The file opened once and parsed at most once, or nothing when it cannot be opened. */
async function subjectFor(file: string, root: string): Promise<TaintSubject | undefined> {
  let source: string;
  try {
    source = await readFile(join(root, file), 'utf8');
  } catch {
    // The scan already said this file is `unknown`; a taint has nothing to add.
    return undefined;
  }

  let tree: Node | undefined;
  return {
    file,
    source,
    program: () => {
      tree ??= parseSync(file, source, TRANSFER).program as unknown as Node;
      return tree;
    },
  };
}

function add(into: Map<string, Set<string>>, value: string, name: string): void {
  const held = into.get(value) ?? new Set<string>();
  held.add(name);
  into.set(value, held);
}
