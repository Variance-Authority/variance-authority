import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uses } from './uses.js';

/**
 * `docs_uses` asked about a module is `docs_discover` asked who imports it,
 * decided by what the checkout holds at the name rather than by how the name
 * is spelled.
 */

function checkout(files: Readonly<Record<string, string>>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-uses-module-')));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const ROOT = checkout({
  'package.json': '{}',
  'tsconfig.json': '{}',
  'src/greet.ts': 'export const greet = 1;\n',
  'node_modules/react/package.json': JSON.stringify({ name: 'react' }),
  'node_modules/@acme/lib/package.json': JSON.stringify({ name: '@acme/lib' }),
});

describe('docs_uses over a module', () => {
  it('asks who imports a file the checkout holds at the name, whatever the name holds', () => {
    expect(uses.restated?.({ name: 'tsconfig.json' }, ROOT)).toMatchObject({ tool: 'docs_discover', input: { imports: ['tsconfig.json'] }, also: false });
    expect(uses.restated?.({ name: './src/greet.ts', limit: 3 }, ROOT)).toMatchObject({ input: { imports: ['src/greet.ts'], limit: 3 }, also: false });
  });

  it('asks who imports a package the checkout resolves, and asks it as a name too', () => {
    expect(uses.restated?.({ name: 'react' }, ROOT)).toMatchObject({ tool: 'docs_discover', input: { imports: ['react'] }, also: true });
    expect(uses.restated?.({ name: '@acme/lib/src/deep' }, ROOT)).toMatchObject({ input: { imports: ['@acme/lib/src/deep'] }, also: true });
  });

  it('leaves a name no file or package is at to `uses`', () => {
    expect(uses.restated?.({ name: 'greet' }, ROOT)).toBeUndefined();
    expect(uses.restated?.({ name: 'src/missing.ts' }, ROOT)).toBeUndefined();
  });

  it('says a path no file of the checkout is at is no path', () => {
    expect(() => uses.restated?.({ name: './src/missing.ts' }, ROOT)).toThrow('`./src/missing.ts` is a path, and no file of the checkout is at it.');
    expect(() => uses.restated?.({ name: '../outside.ts' }, ROOT)).toThrow('is a path, and no file of the checkout is at it.');
  });
});
