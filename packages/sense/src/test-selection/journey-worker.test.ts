/**
 * A Worker bundles the journey head with everything it imports, and workerd has
 * no native addon to load: a bundler that meets the addon's computed `require`
 * refuses the build before the Worker runs.
 */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const entry = fileURLToPath(new URL('./journey.ts', import.meta.url));

it('bundles the journey head without the native addon', async () => {
  const { metafile } = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'neutral',
    format: 'esm',
    external: ['node:*'],
    logLevel: 'silent',
  });
  const reached = Object.keys(metafile.inputs).filter((input) => /(^|\/)src\/addon\.ts$/.test(input));
  expect(reached).toEqual([]);
});
