import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTestSelection, type TestSelectionOptions } from './vitest.js';

type Generate = (context: { readonly id: string }) => string | undefined | false;

/** The key generator the seam's plugin hands Vitest, under the name the given Vitest calls it by. */
async function generatorFor(
  name: 'defineCacheKeyGenerator' | 'experimental_defineCacheKeyGenerator',
  predicates: (root: string) => Pick<TestSelectionOptions, 'include' | 'unprobed'> = (root) => ({
    include: (file) => file.startsWith(resolve(root, 'src')),
  }),
) {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-module-cache-'));
  try {
    const config = withTestSelection({ root }, { root, coverageFile: resolve(root, 'coverage.bin'), ...predicates(root) });
    const plugin = (config.plugins as unknown as { name: string; configureVitest?: (context: object) => void }[])
      .find((one) => one.name === 'variance-authority:test-selection');
    const generators: Generate[] = [];
    const vitest = { config: { sequence: {} }, logger: { printBanner() {} } };
    plugin?.configureVitest?.({ vitest, [name]: (generate: Generate) => generators.push(generate) });
    return { root, runner: config.test!.runner as string, generators };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('Vitest\'s file-system module cache', () => {
  // A cached module skips every transform, so a module the seam probed in an
  // earlier run would run with probes this run never registered, and the fold
  // refuses the record. Vitest 5 turns the cache on by default; measured on
  // `cases/vitest-5-case`, whose second run lost `add.ts`.
  it('keeps every module the seam takes out of the cache, and leaves the rest in it, on Vitest 5', async () => {
    const { root, runner, generators } = await generatorFor('defineCacheKeyGenerator');

    expect(generators).toHaveLength(1);
    const [generate] = generators;
    expect(generate!({ id: resolve(root, 'src/add.ts') })).toBe(false);
    expect(generate!({ id: resolve(root, 'node_modules/left-pad/index.js') })).toBeUndefined();
    expect(generate!({ id: runner })).toBeUndefined();
  });

  it('does the same through the name Vitest 4.1 gives it', async () => {
    const { root, generators } = await generatorFor('experimental_defineCacheKeyGenerator');

    expect(generators).toHaveLength(1);
    expect(generators[0]!({ id: resolve(root, 'src/add.ts') })).toBe(false);
  });

  // A dependency under `node_modules` is taken only when the configuration's
  // own predicate names it, so the cache reads that predicate, not the default.
  it('keeps a dependency the configuration\'s include takes out of the cache', async () => {
    const inlined = (root: string): string => resolve(root, 'node_modules/inlined/index.js');
    const { root, generators } = await generatorFor('defineCacheKeyGenerator', (root) => ({
      include: (file) => file === inlined(root),
    }));

    expect(generators[0]!({ id: inlined(root) })).toBe(false);
    expect(generators[0]!({ id: resolve(root, 'node_modules/left-pad/index.js') })).toBeUndefined();
  });

  it('keeps a dependency the configuration marks unprobed out of the cache', async () => {
    const marked = (root: string): string => resolve(root, 'node_modules/marked/index.js');
    const { root, generators } = await generatorFor('defineCacheKeyGenerator', (root) => ({
      include: () => false,
      unprobed: (file) => file === marked(root),
    }));

    expect(generators[0]!({ id: marked(root) })).toBe(false);
    expect(generators[0]!({ id: resolve(root, 'node_modules/left-pad/index.js') })).toBeUndefined();
  });
});
