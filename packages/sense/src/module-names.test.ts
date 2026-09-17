import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nameModules, readModuleNames, type ModuleNames } from './module-names.js';
import { withIndexLock } from './test-selection/index-lock.js';

/**
 * {@link nameModules} under the exclusion it requires.
 *
 * Every test here grows the table, and growing it is what the lock covers — so
 * the fixture takes one rather than each test remembering to, which is the same
 * reason the production folds hand one another a token instead of a convention.
 */
async function number(names: string, paths: Iterable<string>): Promise<ModuleNames> {
  const held = await withIndexLock(join(dirname(names), 'coverage.bin'), (lock) =>
    nameModules(names, paths, lock),
  );
  if (!held.held) throw new Error(`the index beside ${names} was already held`);
  return held.value;
}

describe('the module name table', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const directory of made) await rm(directory, { recursive: true, force: true });
  });

  async function path(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'variance-module-names-'));
    made.push(directory);
    return join(directory, 'names.bin');
  }

  it('has no number for a repository it has never read', async () => {
    const names = readModuleNames(await path());

    expect(names.count).toBe(0);
    expect(names.idOf('src/cart.js')).toBeUndefined();
  });

  it('numbers what it is given and answers in both directions', async () => {
    const file = await path();
    const names = await number(file, ['src/cart.js', 'src/total.js']);

    expect(names.count).toBe(2);
    expect(names.pathOf(names.idOf('src/cart.js')!)).toBe('src/cart.js');
    expect(names.pathOf(names.idOf('src/total.js')!)).toBe('src/total.js');
  });

  it('keeps the numbers it gave when a file is added', async () => {
    const file = await path();
    const before = await number(file, ['src/cart.js', 'src/total.js']);
    const held = [before.idOf('src/cart.js'), before.idOf('src/total.js')];

    const after = await number(file, ['src/basket.js', 'src/cart.js', 'src/total.js']);

    expect([after.idOf('src/cart.js'), after.idOf('src/total.js')]).toEqual(held);
    expect(after.idOf('src/basket.js')).toBe(2);
  });

  it('reads back what another process committed', async () => {
    const file = await path();
    await number(file, ['src/cart.js', 'src/total.js']);

    expect(readModuleNames(file).idOf('src/total.js')).toBe(1);
  });

  it('numbers a batch by path, so two machines agree on what to call it', async () => {
    const one = await number(await path(), ['src/zebra.js', 'src/apple.js']);
    const other = await number(await path(), ['src/apple.js', 'src/zebra.js']);

    expect(one.idOf('src/apple.js')).toBe(other.idOf('src/apple.js'));
    expect(one.idOf('src/zebra.js')).toBe(other.idOf('src/zebra.js'));
  });

  it('writes nothing when every path is already numbered', async () => {
    const file = await path();
    await number(file, ['src/cart.js']);
    const again = await number(file, ['src/cart.js']);

    expect(again.count).toBe(1);
  });

  it('answers for paths that share every byte but the last', async () => {
    const paths = Array.from({ length: 300 }, (_, index) => `packages/app/src/view/page-${index}.ts`);
    const names = await number(await path(), paths);

    for (const [index, name] of [...paths].sort().entries()) {
      expect(names.idOf(name)).toBe(index);
      expect(names.pathOf(index)).toBe(name);
    }
  });

  it('has no number for a path that sorts between two it holds', async () => {
    const names = await number(await path(), ['src/a.js', 'src/c.js']);

    expect(names.idOf('src/b.js')).toBeUndefined();
    expect(names.idOf('src/z.js')).toBeUndefined();
    expect(names.idOf('src/0.js')).toBeUndefined();
  });

  it('is an empty table when the committed bytes are not a table', async () => {
    const file = await path();
    await writeFile(file, Buffer.from('not a manifest'));

    expect(readModuleNames(file).count).toBe(0);
  });

  it('keeps the numbers across a chain long enough to compact', async () => {
    const file = await path();
    const held = new Map<string, number>();
    for (let round = 0; round < 12; round += 1) {
      const names = await number(file, [`src/round-${round}.js`]);
      for (const [name, id] of held) expect(names.idOf(name)).toBe(id);
      held.set(`src/round-${round}.js`, names.idOf(`src/round-${round}.js`)!);
    }

    const final = readModuleNames(file);
    for (const [name, id] of held) expect(final.idOf(name)).toBe(id);
  });
});
