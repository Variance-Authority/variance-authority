import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readHelp } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { symbol } from './symbol.js';

/**
 * `symbol` over a name a file exports and no entry publishes: the declaration
 * is answered as a published or an unexported one is — its kind, its
 * signature and its doc, read off the source index — never as the line it is
 * written on.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-exported-cache-'));
});
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-symbol-exported-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'tools/loop.mjs': [
      '/**',
      ' * What the loop says when the selection keeps no test.',
      ' */',
      'export async function idle(value, files) {',
      '  return [value, files].join(" ");',
      '}',
      '',
    ].join('\n'),
    'tools/run.mjs': "import { idle } from './loop.mjs';\nawait idle(1, 2);\n",
    'packages/kit/package.json': JSON.stringify({ name: 'kit' }),
    'packages/kit/src/internal/clamp.ts': '/** The value, held under the ceiling. */\nexport const clamp = (value: number): number => value;\n',
    'packages/app/package.json': JSON.stringify({ name: 'app' }),
    'packages/app/src/bounded.ts': "import { clamp } from 'kit/src/internal/clamp';\nexport const bounded = clamp(140);\n",
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  return root;
}

it('answers an exported name with its kind, its signature and its doc, not the line it is written on', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'idle' }, { root });
  expect(out).toContain('idle [function]\n');
  expect(out).toContain('async function idle(value, files)');
  expect(out).toContain('What the loop says when the selection keeps no test.');
  expect(out).not.toContain('export async function idle(value, files) {');
});

it('answers a name imported by the path of its file with its kind, its signature and its doc', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'clamp' }, { root });
  expect(out).toContain('clamp [const]\n');
  expect(out).toContain('The value, held under the ceiling.');
});
