import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readUsage } from './read-usage.js';

/**
 * Every export the package stage reads carries the name it binds in its own
 * file, so which declaration an export is can be told apart without the
 * source index: `export default greet` and `export { greet }` bind one.
 */

const root = mkdtempSync(join(tmpdir(), 'read-usage-bound-'));
mkdirSync(join(root, 'src'));
writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'lib' }));
writeFileSync(join(root, 'src/greet.ts'), 'export function greet(): void {}\nexport default greet;\nexport { greet as hello };\n');
writeFileSync(join(root, 'src/badge.ts'), 'export default function Badge(): void {}\n');
writeFileSync(join(root, 'src/anonymous.ts'), 'export default function (): void {}\n');
writeFileSync(join(root, 'src/door.ts'), "export { default as Thing } from './anonymous.js';\n");
writeFileSync(join(root, 'src/pass.ts'), "import b from './badge.js';\nexport default b;\nexport { b as again };\n");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const exported = readUsage(root, new Set()).exported;
const bound = (at: string): readonly (readonly [string, string | undefined])[] =>
  exported.filter((one) => one.at === at).map((one) => [one.name, one.bound] as const);

describe('the name an export binds in its own file', () => {
  it('is the same binding under every name its file exports it by', () => {
    expect(bound('src/greet.ts')).toEqual([
      ['greet', 'greet'],
      ['default', 'greet'],
      ['hello', 'greet'],
    ]);
  });

  it('is the name a default export declares', () => {
    expect(bound('src/badge.ts')).toEqual([['default', 'Badge']]);
  });

  it('is the slot `default` for an anonymous default export', () => {
    expect(bound('src/anonymous.ts')).toEqual([['default', 'default']]);
  });

  it('is absent for an export that passes another file’s on', () => {
    expect(bound('src/door.ts')).toEqual([['Thing', undefined]]);
  });

  it('is absent for a name the file imports, which binds nothing of its own', () => {
    expect(bound('src/pass.ts')).toEqual([
      ['again', undefined],
      ['default', undefined],
    ]);
  });
});
