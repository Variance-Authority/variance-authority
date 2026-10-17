import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask stack` judges a file's imports against the manifest nearest
 * above it, the owning manifest of ADR-0082.
 * `site/` is a project of its own, with its own manifest and its own install,
 * and the root's `workspaces` do not list it: its files were read against the
 * root manifest, so every package it declares read as imported and not
 * declared.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-stack-owner-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

it('reads a file in a nested project that is not a workspace against that project\'s own manifest', async () => {
  checkout({
    'site/package.json': JSON.stringify({ name: 'site', private: true, dependencies: { 'site-kit': '1.0.0' } }),
    'site/app/page.ts': "import { render } from 'site-kit';\nexport const page = render();\n",
    'site/node_modules/site-kit/package.json': JSON.stringify({ name: 'site-kit', version: '1.0.0', types: 'index.d.ts' }),
    'site/node_modules/site-kit/index.d.ts': 'export declare function render(): string;\n',
  });
  expect((await run(['index'])).code).toBe(EXIT_CLEAN);

  const { code, out, err } = await run(['ask', 'stack', '--from', 'site/app/page.ts']);
  expect(err).toBe('');
  expect(code).toBe(EXIT_CLEAN);
  expect(out).toContain('1 packages usable from site/app/page.ts, under site/package.json: 1 imported, 0 declared and not imported, 0 with imports not read.');
  expect(out).toContain('site-kit@1.0.0 · types-only · dependency in site/package.json · imported 1× (first site/app/page.ts:1)');
  expect(out).not.toContain('imported, not declared there');
});
