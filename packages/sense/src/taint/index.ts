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
 * Every taint produces an {@link ImportDiff} per file: specifiers the file
 * does **not** import despite writing them, and specifiers it **does** import
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
 * ## Composition
 *
 * Under more than one taint the removals are unioned and so are the additions.
 * The two never contend: an edge one taint adds to a file another taint shadows
 * is an edge into a node the file's run never enters, and the shadow holds, the
 * way the mock holds at runtime.
 */

// compass: variance-authority.reach

import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { FileEdge, FileRecord } from '@variance-authority/core/relate';
import { parseSync, rawTransferSupported, type ParserOptions } from 'oxc-parser';
import type { Node } from '../instrument/blocks.js';
import { MODULE_EXTENSIONS } from '../read.js';
import {
  isRelative,
  kindFor,
  realPath,
  requestOf,
  resolveTo,
  resolversFor,
  type ResolveOptions,
  type Resolvers,
} from '../resolve.js';

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
  /** For the report. Two taints with one name are one taint twice. */
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
}

/** The records with the additions joined on, and the two tables beside them. */
export interface Tainted {
  /** One per input, in order; a record no taint adds to is the same object. */
  readonly records: readonly FileRecord[];
  /**
   * Per file, the resolved files its run never reaches. The table `movedBy`
   * takes as `shadows`. A removal that resolves to nothing names no node and
   * cuts nothing.
   */
  readonly shadows: ReadonlyMap<string, readonly string[]>;
  /** Per file, the resolved files its additions reached. For the audit and the report. */
  readonly additions: ReadonlyMap<string, readonly string[]>;
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
 * and misses is the same hole a file naming one is.
 */
export async function taintRecords(
  records: readonly FileRecord[],
  taints: readonly Taint[],
  options: TaintOptions,
): Promise<Tainted> {
  const shadows = new Map<string, readonly string[]>();
  const additions = new Map<string, readonly string[]>();
  if (taints.length === 0) return { records, shadows, additions };

  const root = realPath(resolve(options.root));
  const resolvers = resolversFor(options);
  const readers = taints.filter((taint) => taint.read !== undefined);
  const joined: FileRecord[] = [];

  for (const record of records) {
    const diff = await diffFor(record.file, root, taints, readers);
    if (diff === undefined) {
      joined.push(record);
      continue;
    }
    const target = targetFrom(record.file, root, resolvers);
    const cut = resolvedOf(diff.minus, target);
    if (cut.length > 0) shadows.set(record.file, cut);
    if (diff.plus === undefined || diff.plus.length === 0) {
      joined.push(record);
      continue;
    }
    const added = applied(record, diff.plus, target);
    joined.push(added.record);
    if (added.reached.length > 0) additions.set(record.file, added.reached);
  }

  return { records: joined, shadows, additions };
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

/** Every taint's diff for one file, composed, or nothing when no taint has one. */
async function diffFor(
  file: string,
  root: string,
  taints: readonly Taint[],
  readers: readonly Taint[],
): Promise<ImportDiff | undefined> {
  const minus = new Set<string>();
  const plus = new Set<string>();
  let found = false;

  const fold = (diff: ImportDiff | undefined): void => {
    if (diff === undefined) return;
    found = true;
    for (const value of diff.minus ?? []) minus.add(value);
    for (const value of diff.plus ?? []) plus.add(value);
  };

  for (const taint of taints) fold(taint.diffs?.get(file));

  const asked = readers.filter(
    (taint) => MODULE_EXTENSIONS.includes(extname(file)) && (taint.files?.(file) ?? true),
  );
  if (asked.length > 0) {
    const subject = await subjectFor(file, root);
    if (subject !== undefined) for (const taint of asked) fold(taint.read!(subject));
  }

  return found ? { minus: [...minus], plus: [...plus] } : undefined;
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

type Target = (value: string) => string | undefined;

/** A specifier resolved from one file, the way the scan resolves an import. */
function targetFrom(file: string, root: string, resolvers: Resolvers): Target {
  const from = join(root, file);
  return (value) => {
    const request = requestOf(value);
    return request === undefined ? undefined : resolveTo({ resolvers, root, from, request, style: false });
  };
}

function resolvedOf(values: readonly string[] | undefined, target: Target): readonly string[] {
  const found = new Set<string>();
  for (const value of values ?? []) {
    const to = target(value);
    if (to !== undefined) found.add(to);
  }
  return [...found].sort(byCodeUnit);
}

/** One record with its additions resolved and joined on. */
function applied(
  record: FileRecord,
  plus: readonly string[],
  target: Target,
): { readonly record: FileRecord; readonly reached: readonly string[] } {
  const edges: FileEdge[] = [...(record.edges ?? [])];
  const unresolved = [...(record.unresolved ?? [])];
  const holes: string[] = [];
  const reached = new Set<string>();

  for (const value of plus) {
    const to = target(value);
    if (to === undefined) {
      unresolved.push(value);
      const request = requestOf(value);
      if (request !== undefined && isRelative(request)) holes.push(value);
      continue;
    }
    reached.add(to);
    // The target says what it is: a stylesheet is an asset however it was named.
    edges.push({ to, kind: kindFor('imports', to) });
  }

  const reasons = [
    ...(record.unknown === undefined ? [] : [record.unknown]),
    ...(holes.length === 0
      ? []
      : [`${holes.length} tainted relative specifier(s) that resolve to nothing: ${holes.join(', ')}`]),
  ];

  const { edges: _edges, unresolved: _unresolved, unknown: _unknown, ...rest } = record;
  return {
    record: {
      ...rest,
      ...(edges.length > 0 ? { edges: dedupe(edges) } : {}),
      ...(unresolved.length > 0 ? { unresolved: [...new Set(unresolved)].sort(byCodeUnit) } : {}),
      ...(reasons.length > 0 ? { unknown: reasons.join('; ') } : {}),
    },
    reached: [...reached].sort(byCodeUnit),
  };
}

function dedupe(edges: readonly FileEdge[]): readonly FileEdge[] {
  const seen = new Set<string>();

  return edges
    .filter((edge) => {
      const key = `${edge.kind} ${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => byCodeUnit(a.to, b.to) || byCodeUnit(a.kind, b.kind));
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
