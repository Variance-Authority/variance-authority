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
 * ## Composition
 *
 * Under more than one taint the removals are unioned and so are the additions,
 * and an addition beats a removal. Two taints that disagree describe a file one
 * of them is wrong about, and the direction to be wrong in is the one that
 * keeps the edge ([`selecting.md`](../../../../docs/selecting.md)).
 *
 * ## What a removal removes
 *
 * The file's own edge, and nothing further. `vi.mock('./api')` inside
 * `a.test.ts` cuts `a.test.ts → api.ts`; it does not cut `a.ts → api.ts` for
 * the `a.ts` the test imports, though at runtime that edge is replaced too. A
 * diff that reached across files would be a fact about the *pair*, and the
 * table is keyed by one file. The graph the join hands on still reaches `api.ts`
 * from the test through `a.ts`, which over-includes.
 * TODO: a mock shadowing a transitive import is a cut on the graph, not a row in this table.
 */

// compass: variance-authority.reach

import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { EdgeKind, FileEdge, FileRecord } from '@variance-authority/core/relate';
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

/** An import the file makes without writing it in a form a parser reads. */
export interface Addition {
  /** A specifier, exactly as the file would have written it. */
  readonly value: string;
  /** How it is imported. A value import unless said otherwise. */
  readonly kind?: EdgeKind;
}

/** What one file imports beyond, or short of, what its text says. */
export interface ImportDiff {
  /** Specifiers the file writes and does not import. */
  readonly minus?: readonly string[];
  /** Specifiers the file imports and does not write. */
  readonly plus?: ReadonlyArray<string | Addition>;
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

/** The table a JSON taint file holds: a diff per file, `-` and `+` as keys. */
export type TaintTable = Readonly<
  Record<string, { readonly '-'?: readonly string[]; readonly '+'?: ReadonlyArray<string | Addition> }>
>;

const TRANSFER = { experimentalRawTransfer: rawTransferSupported() } as ParserOptions;

/**
 * The records with every taint's diff joined on.
 *
 * Records come back in the order they arrived, one per input, and a record no
 * taint has a row for is the same object. A removed specifier that the scan had
 * left unresolved leaves `unresolved` too; an added specifier that resolves to
 * nothing lands where the scan would have put it — `unresolved`, and `unknown`
 * when it is relative, because a taint that names a path inside the repository
 * and misses is the same hole a file naming one is.
 */
export async function taintRecords(
  records: readonly FileRecord[],
  taints: readonly Taint[],
  options: TaintOptions,
): Promise<readonly FileRecord[]> {
  if (taints.length === 0) return records;

  const root = realPath(resolve(options.root));
  const resolvers = resolversFor(options);
  const readers = taints.filter((taint) => taint.read !== undefined);
  const joined: FileRecord[] = [];

  for (const record of records) {
    const diff = await diffFor(record.file, root, taints, readers);
    joined.push(diff === undefined ? record : applied(record, diff, root, resolvers));
  }

  return joined;
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
  const plus = new Map<string, Addition>();
  let found = false;

  const fold = (diff: ImportDiff | undefined): void => {
    if (diff === undefined) return;
    found = true;
    for (const value of diff.minus ?? []) minus.add(value);
    for (const entry of diff.plus ?? []) {
      const addition = typeof entry === 'string' ? { value: entry } : entry;
      plus.set(`${addition.kind ?? 'imports'} ${addition.value}`, addition);
    }
  };

  for (const taint of taints) fold(taint.diffs?.get(file));

  const asked = readers.filter(
    (taint) => MODULE_EXTENSIONS.includes(extname(file)) && (taint.files?.(file) ?? true),
  );
  if (asked.length > 0) {
    const subject = await subjectFor(file, root);
    if (subject !== undefined) for (const taint of asked) fold(taint.read!(subject));
  }

  return found ? { minus: [...minus], plus: [...plus.values()] } : undefined;
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

/** One record with one composed diff resolved and joined on. */
function applied(record: FileRecord, diff: ImportDiff, root: string, resolvers: Resolvers): FileRecord {
  const from = join(root, record.file);
  const style = false;
  const target = (value: string): string | undefined => {
    const request = requestOf(value);
    return request === undefined ? undefined : resolveTo({ resolvers, root, from, request, style });
  };

  const cut = new Set<string>();
  const cutSpecifiers = new Set<string>();
  for (const value of diff.minus ?? []) {
    cutSpecifiers.add(value);
    const to = target(value);
    if (to !== undefined) cut.add(to);
  }

  const edges: FileEdge[] = (record.edges ?? []).filter((edge) => !cut.has(edge.to));
  const unresolved = (record.unresolved ?? []).filter((value) => !cutSpecifiers.has(value));
  const holes: string[] = [];

  for (const entry of diff.plus ?? []) {
    const addition = typeof entry === 'string' ? { value: entry } : entry;
    const to = target(addition.value);
    if (to === undefined) {
      unresolved.push(addition.value);
      const request = requestOf(addition.value);
      if (request !== undefined && isRelative(request)) holes.push(addition.value);
      continue;
    }
    edges.push({ to, kind: kindFor(addition.kind ?? 'imports', to) });
  }

  const reasons = [
    ...(record.unknown === undefined ? [] : [record.unknown]),
    ...(holes.length === 0
      ? []
      : [`${holes.length} tainted relative specifier(s) that resolve to nothing: ${holes.join(', ')}`]),
  ];

  const { edges: _edges, unresolved: _unresolved, unknown: _unknown, ...rest } = record;
  return {
    ...rest,
    ...(edges.length > 0 ? { edges: dedupe(edges) } : {}),
    ...(unresolved.length > 0 ? { unresolved: [...new Set(unresolved)].sort(byCodeUnit) } : {}),
    ...(reasons.length > 0 ? { unknown: reasons.join('; ') } : {}),
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
