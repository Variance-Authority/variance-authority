// compass: variance-authority.reach
/**
 * Drift from the walk: the loads of a test file that its imports and the
 * suite's `before` files do not reach, read off a record (spec 0105).
 *
 * The walk is a prediction of what a test loads, and a run can leave it for
 * reasons the source names nowhere as an edge: a `moduleNameMapper` entry, a
 * mock the runner served, a setup file, a computed `require`, a lazy `import()`
 * behind a flag, an environment variable a config reads. So a row is an
 * observed difference, not a defect: it says the run loaded a file the walk
 * does not reach, never why. A mock the runner served is drift like any other
 * runner-made load; a module a test mocks in its own text is never entered,
 * since the runner did not load it for that test.
 *
 * Drift is read in `variance review` against the mainline's, the baseline, and
 * never joins the graph or changes what a selection runs.
 */
import { codeUnitOrder } from '@variance-authority/core/segment';
import { EDGE_KINDS, RUNTIME_EDGES, idOf, type Adjacency, type NodeId, type Relations } from '@variance-authority/core/relate';
import { undone, type BaseEdges } from './base-edges.js';

/** One module's row of a record, as far as this reading needs it. */
export interface LoadedModule {
  readonly file: string;
  readonly blocks: readonly { readonly kind: string; readonly testFiles: readonly string[] }[];
}

/** A test file and a file it loaded. */
export interface DriftRow {
  readonly file: string;
  readonly test: string;
}

/** A record's drift: its rows, and the test files the walk could not read, each with the file it stopped at. */
export interface Drift {
  readonly rows: DriftRow[];
  readonly unread: DriftRow[];
}

export interface DriftOptions {
  /** The source a built file came from (`built-names.ts`). */
  readonly sourceOf?: (file: string) => string;
  /** Walk the merge base rather than the checkout. */
  readonly base?: BaseEdges;
}

/**
 * Every load in `modules` that `relations` does not reach from the test file
 * that made it, nor from a file in `before`, sorted by file and then test.
 */
export function driftFromWalk(
  relations: Relations,
  modules: readonly LoadedModule[],
  before: readonly string[],
  { sourceOf = (file) => file, base }: DriftOptions = {},
): Drift {
  const sources = new Map<string, string>();
  const loadedBy = new Map<string, string[]>();
  for (const module of modules) {
    sources.set(module.file, sourceOf(module.file));
    for (const test of module.blocks.find((block) => block.kind === 'module')?.testFiles ?? []) {
      const files = loadedBy.get(test);
      if (files === undefined) loadedBy.set(test, [module.file]);
      else files.push(module.file);
    }
  }

  const fileId = (name: string) => idOf(relations, 'file', name);
  const ids = (names: Iterable<string>) => [...names].flatMap((name) => fileId(name) ?? []);
  const asked = (names: readonly string[]) =>
    new Set(ids(names.flatMap((name) => relations.shadows.get(name) ?? [])));
  const unknown = base === undefined ? [] : ids(base.unknown).sort((a, b) => a - b);
  const depends = base === undefined ? relations.depends : undone(relations, base);
  const entered = (walk: Walk) => unknown.find((id) => walk.has(id));

  const beforeWalk = new Walk(depends, relations.names.length);
  beforeWalk.enter(ids(before), asked(before));
  const beforeStopped = entered(beforeWalk);
  const walk = new Walk(depends, relations.names.length);

  const rows: DriftRow[] = [];
  const unread: DriftRow[] = [];
  for (const [test, files] of loadedBy) {
    walk.restart();
    walk.enter(ids([test]).filter((id) => base?.created.has(id) !== true), asked([test]));
    const at = entered(walk) ?? beforeStopped;
    const stopped = at === undefined ? files.find((file) => base?.unknown.has(sources.get(file)!) === true) : relations.names[at];
    if (stopped !== undefined) {
      unread.push({ file: stopped, test });
      continue;
    }
    for (const file of files) {
      const id = fileId(sources.get(file)!);
      if (id !== undefined && (walk.has(id) || beforeWalk.has(id))) continue;
      rows.push({ file, test });
    }
  }
  const order = (a: DriftRow, b: DriftRow) => codeUnitOrder(a.file, b.file) || codeUnitOrder(a.test, b.test);
  return { rows: rows.sort(order), unread: unread.sort((a, b) => codeUnitOrder(a.test, b.test)) };
}

const RUNTIME = new Uint8Array(EDGE_KINDS.length);
for (const kind of RUNTIME_EDGES) RUNTIME[EDGE_KINDS.indexOf(kind)] = 1;

/**
 * A forward walk over the runtime edges that is restarted rather than
 * reallocated: a stamp per node marks the current walk, so a walk costs the
 * nodes it enters and not the size of the graph. Each test is walked once, so
 * the check costs what the record lists rather than the graph per file loaded.
 */
class Walk {
  private readonly stamps: Uint32Array;
  private stamp = 1;
  private readonly stack: NodeId[] = [];

  constructor(private readonly depends: Adjacency, nodes: number) {
    this.stamps = new Uint32Array(nodes);
  }

  restart(): void {
    this.stamp += 1;
  }

  has(id: NodeId): boolean {
    return this.stamps[id] === this.stamp;
  }

  /** Adds what `seeds` reach to this walk, never entering a node in `avoid`. */
  enter(seeds: readonly NodeId[], avoid: ReadonlySet<NodeId>): void {
    const { offset, target, kind } = this.depends;
    for (const seed of seeds) this.visit(seed, avoid);
    while (this.stack.length > 0) {
      const id = this.stack.pop()!;
      for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) {
        if (RUNTIME[kind[edge]!] === 1) this.visit(target[edge]!, avoid);
      }
    }
  }

  private visit(id: NodeId, avoid: ReadonlySet<NodeId>): void {
    if (this.has(id) || avoid.has(id)) return;
    this.stamps[id] = this.stamp;
    this.stack.push(id);
  }
}
