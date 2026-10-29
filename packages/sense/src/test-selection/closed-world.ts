// compass: variance-authority.reach
/**
 * The loads a closed world forbids: a test that loaded a file no import reaches.
 *
 * A suite that declares `world: closed` promises that its import graph is the
 * whole story — that a test loads only what it imports, directly or through
 * other files, or what a file the runner loads before every test imports. The
 * record says what each test did load. A load the graph does not reach is a
 * file the `file` and `symbol` steps would not run that test for: a dynamic
 * path, a plugin the runner resolved, a `require` built from a string.
 *
 * A mock the runner served is not one, and its path alone does not say it was
 * served. Jest and Vitest serve `dir/__mocks__/name.ext` for the module
 * `dir/name` when a test asks for that module, and a `__mocks__` directory
 * beside `node_modules` for the package `name`. So a mock counts as served to a
 * test that reaches the module it stands in for, or asked for it by mocking
 * it; what the mock imports is then reached through it. A mock no import of
 * the test reaches is a load like any other.
 */
import { codeUnitOrder } from '@variance-authority/core/segment';
import { EDGE_KINDS, RUNTIME_EDGES, idOf, type NodeId, type Relations } from '@variance-authority/core/relate';

/** One module's row of a record, as far as this reading needs it. */
export interface LoadedModule {
  readonly file: string;
  readonly blocks: readonly { readonly kind: string; readonly testFiles: readonly string[] }[];
}

/** A test file that loaded a file its imports do not reach. */
export interface UnreachedLoad {
  readonly file: string;
  readonly test: string;
}

const MOCKS = '__mocks__/';

/**
 * Every load in `modules` that `relations` does not reach from the test that
 * made it, nor from a file in `before`, sorted by file and then test.
 * `sourceOf` names the source a built file came from (`built-names.ts`).
 */
export function unreachedLoads(
  relations: Relations,
  modules: readonly LoadedModule[],
  before: readonly string[],
  sourceOf: (file: string) => string = (file) => file,
): UnreachedLoad[] {
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
  const originals = mockOriginals(relations);

  const beforeAsked = asked(before);
  const beforeWalk = new Walk(relations);
  beforeWalk.enter(ids(before), beforeAsked);
  const walk = new Walk(relations);

  const unreached: UnreachedLoad[] = [];
  for (const [test, files] of loadedBy) {
    const testAsked = asked([test]);
    walk.restart();
    walk.enter(ids([test]), testAsked);
    const requested = (id: NodeId) => walk.has(id) || beforeWalk.has(id) || testAsked.has(id) || beforeAsked.has(id);

    const mocks = files.filter((file) => isMock(sources.get(file)!));
    const served = new Set<string>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const mock of mocks) {
        if (served.has(mock) || !originals(sources.get(mock)!).some(requested)) continue;
        served.add(mock);
        walk.enter(ids([sources.get(mock)!]), testAsked);
        grew = true;
      }
    }

    for (const file of files) {
      if (served.has(file)) continue;
      const id = fileId(sources.get(file)!);
      if (id !== undefined && (walk.has(id) || beforeWalk.has(id))) continue;
      unreached.push({ file, test });
    }
  }
  return unreached.sort((a, b) => codeUnitOrder(a.file, b.file) || codeUnitOrder(a.test, b.test));
}

const isMock = (file: string): boolean => file.startsWith(MOCKS) || file.includes(`/${MOCKS}`);

/**
 * The nodes a mock stands in for, by the runners' rule: the files beside the
 * `__mocks__` directory with the mock's path and any extension, and the
 * package the path names.
 */
function mockOriginals(relations: Relations): (mock: string) => readonly NodeId[] {
  let byStem: Map<string, NodeId[]> | undefined;
  return (mock) => {
    if (byStem === undefined) {
      byStem = new Map();
      for (const [key, id] of relations.index) {
        if (!key.startsWith('file:')) continue;
        const stem = withoutExtension(key.slice('file:'.length));
        const same = byStem.get(stem);
        if (same === undefined) byStem.set(stem, [id]);
        else same.push(id);
      }
    }
    const at = mock.lastIndexOf(MOCKS);
    const stem = withoutExtension(mock.slice(at + MOCKS.length));
    const files = byStem.get(mock.slice(0, at) + stem) ?? [];
    const segments = stem.split('/');
    const name = segments[0]!.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
    const pkg = idOf(relations, 'package', name);
    return pkg === undefined ? files : [...files, pkg];
  };
}

function withoutExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
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

  constructor(private readonly relations: Relations) {
    this.stamps = new Uint32Array(relations.names.length);
  }

  restart(): void {
    this.stamp += 1;
  }

  has(id: NodeId): boolean {
    return this.stamps[id] === this.stamp;
  }

  /** Adds what `seeds` reach to this walk, never entering a node in `avoid`. */
  enter(seeds: readonly NodeId[], avoid: ReadonlySet<NodeId>): void {
    const { offset, target, kind } = this.relations.depends;
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
