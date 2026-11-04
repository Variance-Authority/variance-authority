import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll } from 'vitest';
import { ROOT, type Fence, fencesIn, prose } from './markdown.js';

/** What a page's lines are run against: its fences, and a reader's repository with no config. */

const made: string[] = [];

afterAll(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** The fenced blocks of a section, or none when the page has no such section. */
export function printed(page: string, heading: string): readonly Fence[] {
  const lines = prose(page).split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return fencesIn(page).filter((fence) => fence.line > start && fence.line <= next);
}

export const shellLines = (fences: readonly Fence[]): readonly string[] =>
  fences.filter((fence) => fence.lang === 'bash').flatMap((fence) => fence.code.trim().split('\n'));

const manifest = (name: string, more: object) =>
  `${JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './src/index.ts', ...more })}\n`;

/** The two shapes a reader's repository takes, whose answers differ. */
const SHAPES = {
  'several packages': {
    'package.json': '{"name":"shop","private":true,"type":"module","workspaces":["packages/*"]}\n',
    'packages/price/package.json': manifest('@shop/price', {}),
    'packages/price/src/index.ts': 'export const price = (net: number) => net * 1.2;\n',
    'packages/cart/package.json': manifest('@shop/cart', { dependencies: { '@shop/price': '1.0.0' } }),
    'packages/cart/src/index.ts': "import { price } from '@shop/price';\nexport const total = price(1);\n",
  },
  'one package': {
    'package.json': manifest('shop', {}),
    'src/index.ts': 'export const price = (net: number) => net * 1.2;\n',
  },
} as const;

export type Shape = keyof typeof SHAPES;

/** A git repository with no variance config, the packages built here standing in for the install. */
export function repository(shape: Shape): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-agent-install-')));
  made.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(SHAPES[shape])) write(path, text);
  write('.gitignore', 'node_modules\n');
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@variance-authority'));
  for (const [name, bin] of [
    ['cli', 'variance'],
    ['help', 'variance-authority-help'],
    ['mcp', 'variance-authority-mcp'],
  ] as const) {
    symlinkSync(join(ROOT, 'packages', name), join(root, 'node_modules/@variance-authority', name));
    // A shell script for `npm install`'s link and mode: the build leaves `dist/bin.js` unexecutable.
    write(`node_modules/.bin/${bin}`, `#!/bin/sh\nexec node "${join(ROOT, 'packages', name, 'dist/bin.js')}" "$@"\n`);
    chmodSync(join(root, 'node_modules/.bin', bin), 0o755);
  }
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=reader', '-c', 'user.email=reader@example.com', 'commit', '-qm', 'init'], {
    cwd: root,
  });
  return root;
}
