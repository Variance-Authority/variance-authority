import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readHelp } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { refreshDependencyLexicon } from '../dependency-lexicon.js';
import { stack } from './stack.js';

/**
 * `stack --from` lists what the owning manifest offers, imported first, in a
 * stable order that pages. `alpha` imports one of its two dependencies and
 * declares a dev tool; `beta` declares one package `alpha` does not.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

it('lists every package usable at a path, imported before unused, and pages with a count of what remains', async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-stack-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-stack-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }),
    'packages/alpha/package.json': JSON.stringify({
      name: 'alpha',
      dependencies: { 'used-kit': '1.0.0', 'idle-kit': '3.0.0' },
      devDependencies: { 'dev-kit': '2.0.0' },
    }),
    'packages/alpha/src/x.ts': "import { usedName } from 'used-kit';\nexport const alpha = usedName;\n",
    'packages/beta/package.json': JSON.stringify({ name: 'beta', dependencies: { 'beta-kit': '4.0.0' } }),
    'packages/beta/src/x.ts': 'export const beta = 1;\n',
  };
  for (const [kit, version] of [['used-kit', '1.0.0'], ['idle-kit', '3.0.0'], ['dev-kit', '2.0.0']] as const) {
    files[`packages/alpha/node_modules/${kit}/package.json`] = JSON.stringify({ name: kit, version, types: 'index.d.ts' });
    files[`packages/alpha/node_modules/${kit}/index.d.ts`] = `export declare const ${kit.replace(/-/g, '')}: number;\nexport declare const usedName: number;\n`;
  }
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  await refreshDependencyLexicon(root);

  const help = readHelp(root);
  const ask = (input: Record<string, unknown>): string => stack.run(help, input, { root });
  const all = ask({ from: 'packages/alpha/src/x.ts' });
  expect(all).toContain('3 packages usable from packages/alpha/src/x.ts, under packages/alpha/package.json: 1 imported, 2 declared and not imported, 0 with imports not read.');
  expect(all.indexOf('Imported here:')).toBeLessThan(all.indexOf('Declared, not imported here:'));
  expect(all).toContain('used-kit@1.0.0 · types-only · dependency in packages/alpha/package.json · imported 1× (first packages/alpha/src/x.ts:1)');
  expect(all).toContain('idle-kit@3.0.0 · types-only · dependency in packages/alpha/package.json · not imported');
  expect(all).toContain('dev-kit@2.0.0 · types-only · dev in packages/alpha/package.json · not imported');
  expect(all).not.toContain('beta-kit');
  expect(all).toContain('No more rows.');

  const first = ask({ from: 'packages/alpha', limit: 2 });
  expect(first).toContain('Rows 1–2.');
  expect(first).toContain('1 more rows; ask again with --offset 2.');
  const second = ask({ from: 'packages/alpha', limit: 2, offset: 2 });
  expect(second).toContain('Rows 3–3.');
  expect(second).toContain('No more rows.');
  expect(`${first}\n${second}`).toContain('dev-kit');
  // Declared and not installed: listed with no version, and the reason it could not be read is said.
  const beta = ask({ from: 'packages/beta/src/x.ts' });
  expect(beta).toContain('beta-kit (version not resolved)');
  expect(beta).toContain('beta-kit in packages/beta/package.json — the project resolver could not locate `beta-kit`');
  expect(() => ask({ from: 'packages/alpha', limit: 0 })).toThrow('--limit');
});
