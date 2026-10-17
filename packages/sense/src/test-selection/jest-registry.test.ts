import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The check as the setup file loads it: built, because it `require`s its neighbours by the names the build gives them. */
const registry = createRequire(import.meta.url)(
  '../../dist/test-selection/jest-registry.cjs',
) as typeof import('./jest-registry.cjs');

const root = resolve('/checkout');
const at = (path: string): string => resolve(root, path);

describe("Jest's registry, held against what the file entered", () => {
  it('names a module the registry holds and whose probes registered, but that no observation entered', () => {
    expect(registry.unentered(
      root,
      [at('src/a.ts'), at('src/b.ts')],
      ['src/a.ts@aa', 'src/b.ts@bb'],
      ['src/a.ts@aa'],
    )).toEqual(['src/b.ts']);
  });

  it('reads a marked module by its path, as a probed one', () => {
    expect(registry.unentered(root, [at('src/env.ts')], ['src/env.ts@~ee'], ['src/env.ts@ee'])).toEqual([]);
    expect(registry.unentered(root, [at('src/env.ts')], ['src/env.ts@~ee'], [])).toEqual(['src/env.ts']);
  });

  it('holds nothing against a registry module no probe registered for: the transform placed none there', () => {
    expect(registry.unentered(root, [at('test/a.test.ts'), at('setup.ts'), '/elsewhere/lib.js'], [], [])).toEqual([]);
  });

  it('holds nothing against a registered module the registry no longer holds: reset, isolated or automocked', () => {
    expect(registry.unentered(root, [], ['src/once.ts@11'], [])).toEqual([]);
  });
});
