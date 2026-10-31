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
    'packages/kit/src/internal/rate.ts': '/** What a rate holds. */\ninterface Rate {\n  percent: number;\n}\n/** The rate every bill starts from. */\nexport const Rate = 0.2;\n',
    'packages/kit/src/internal/range.ts': 'export interface Range {\n  clamp(value: number): number;\n}\n',
    'packages/kit/src/internal/sized.ts': [1, 2, 3, 4, 5, 6].map((n) => `export interface Sized${n} {\n  size: number;\n}\n`).join(''),
    'packages/kit/src/internal/limit.ts': "export { clamp as limit } from './clamp.js';\n",
    'packages/kit/src/internal/tax.ts': '/** The tax an amount owes. */\nfunction taxOf(amount: number): number {\n  return amount;\n}\nexport { taxOf as levy };\n',
    'tools/tax.mjs': '/** The tax an amount owes. */\nfunction taxOf(amount) {\n  return amount;\n}\nexport { taxOf as duty };\n',
    'tools/pay.mjs': "import { duty } from './tax.mjs';\nduty(1);\n",
    'packages/app/package.json': JSON.stringify({ name: 'app' }),
    'packages/app/src/bounded.ts': "import { clamp } from 'kit/src/internal/clamp';\nexport const bounded = clamp(140);\n",
    'packages/app/src/levied.ts': "import { levy } from 'kit/src/internal/tax';\nexport const levied = levy(140);\n",
    'packages/app/src/limited.ts': "import { limit } from 'kit/src/internal/limit';\nexport const limited = limit(140);\n",
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

it('answers an export by the declaration it binds when the file declares a type of the same name first', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'Rate' }, { root });
  expect(out).toContain('Rate [const]\n');
  expect(out).toContain('The rate every bill starts from.');
  expect(out).not.toContain('What a rate holds.');
});

it('answers a name imported by the path of its file with its members beside it, as its files name them', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'clamp' }, { root });
  expect(out).toContain('clamp [const]\n');
  expect(out).toContain('a member of `Range`, declared at packages/kit/src/internal/range.ts:2');
  const files = symbol.files?.(readHelp(root), { name: 'clamp' }, { root });
  expect([...(files?.files.keys() ?? [])]).toContain('packages/kit/src/internal/range.ts');
});

it('lists the first members of a name many containers declare, and counts the rest', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'size' }, { root });
  expect(out.match(/a member of `Sized\d`/gu)).toHaveLength(5);
  expect(out).toContain('1 more member declaration of `size` not shown.');
});

it('answers a name imported by the path of a file that passes it on with what it passes on', async () => {
  const root = await workspace();
  const out = symbol.run(readHelp(root), { name: 'limit' }, { root });
  expect(out).toContain('limit [const]\n');
  expect(out).toContain('The value, held under the ceiling.');
});

it('answers a name its file exports under another name with the declaration it binds', async () => {
  const root = await workspace();
  for (const name of ['levy', 'duty']) {
    const out = symbol.run(readHelp(root), { name }, { root });
    expect(out).toContain(`${name} [function]\n`);
    expect(out).toContain('function taxOf(amount');
    expect(out).toContain('The tax an amount owes.');
    expect(out).not.toContain(`export { taxOf as ${name} };`);
  }
});

it.todo('answers an export list that names a type and a value of one name with both declarations it binds — needs the walk to end at every declaration of the bound name');
