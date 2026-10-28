import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createTransformer } from './jest.js';

it('keys a module by whether its package declares side effects, so declaring them reaches a cached module', async () => {
  const root = mkdtempSync(join(tmpdir(), 'isolator-jest-key-'));
  mkdirSync(join(root, 'src'));
  const path = join(root, 'src/a.ts');
  const manifest = (sideEffects: boolean) => writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', sideEffects }));
  const options = { configString: '{}', instrument: false, config: { rootDir: root, testMatch: ['**/*.test.ts'], testRegex: [] } };
  const key = async () => (await createTransformer({ root })).getCacheKey!('let a = 0; a++;', path, options as never);

  manifest(false);
  const rewritten = await key();
  manifest(true);
  expect(await key()).not.toBe(rewritten);
});
