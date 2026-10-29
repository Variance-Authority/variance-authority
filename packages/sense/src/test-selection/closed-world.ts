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
 * A mock the runner served is not one. Jest and Vitest serve the module beside
 * the one asked for from a `__mocks__` directory, and the import names the
 * original, which the graph reaches.
 */
import { RUNTIME_EDGES, affectedBy, type Relations } from '@variance-authority/core/relate';

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

const MOCK_DIRECTORY = /(^|\/)__mocks__\//;

/**
 * Every load in `modules` that `relations` does not reach from the test that
 * made it, nor from a file in `before`, the files the runner loads ahead of
 * every test. Repository-relative paths throughout.
 *
 * `sourceOf` names the source a recorded file was built from. The recorder
 * names a built module by its source through the map beside it, and a module
 * the map cannot carry back — one that holds only types — keeps its built name,
 * which no import in the graph names (`built-names.ts`).
 */
export function unreachedLoads(
  relations: Relations,
  modules: readonly LoadedModule[],
  before: readonly string[],
  sourceOf: (file: string) => string = (file) => file,
): UnreachedLoad[] {
  const unreached: UnreachedLoad[] = [];
  for (const module of modules) {
    if (MOCK_DIRECTORY.test(module.file)) continue;
    const loaders = module.blocks.find((block) => block.kind === 'module')?.testFiles ?? [];
    if (loaders.length === 0) continue;
    const reached = new Set(affectedBy(relations, [sourceOf(module.file)], { through: RUNTIME_EDGES }).files);
    if (before.some((file) => reached.has(file))) continue;
    for (const test of loaders) if (!reached.has(test)) unreached.push({ file: module.file, test });
  }
  return unreached;
}
