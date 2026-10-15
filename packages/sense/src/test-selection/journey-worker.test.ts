/**
 * A Worker bundles the journey head with everything it imports, and workerd has
 * no native addon to load: a bundler that meets the addon's computed `require`
 * refuses the build before the Worker runs.
 *
 * What a bundler follows is the head's runtime requests, file to file, so the
 * test walks those with the module reader and never runs a bundler: a
 * type-only import is erased before bundling and is not followed here either.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_EDGES } from '@variance-authority/core/relate';
import { expect, it } from 'vitest';
import { readModule } from '../read.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const RUNTIME = new Set<string>(RUNTIME_EDGES);

/** The file a relative request names, as TypeScript's `.js`-for-`.ts` rule resolves it. */
function resolved(from: string, value: string): string | undefined {
  const written = join(dirname(from), value);
  const stem = written.replace(/\.[cm]?js$/, '');
  return [written, `${stem}.ts`, `${stem}.tsx`, join(written, 'index.ts')].find((file) => existsSync(file) && /\.[cm]?[jt]sx?$/.test(file));
}

/** Every first-party file the module at `entry` loads at run time, itself included. */
function loads(entry: string): string[] {
  const seen = new Set<string>([entry]);
  for (const file of seen) {
    for (const request of readModule(file, readFileSync(file, 'utf8')).requests) {
      if (!RUNTIME.has(request.kind) || !request.value.startsWith('.')) continue;
      const next = resolved(file, request.value);
      if (next !== undefined) seen.add(next);
    }
  }
  return [...seen].map((file) => relative(SRC, file));
}

it('bundles the journey head without the native addon', () => {
  expect(loads(join(SRC, 'test-selection/journey.ts'))).not.toContain('addon.ts');
});

it('reads the addon where the instrumentation index loads it, so the walk can see it', () => {
  expect(loads(join(SRC, 'instrument/index.ts'))).toContain('addon.ts');
});
