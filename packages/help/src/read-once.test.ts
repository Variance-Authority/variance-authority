import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspace } from './read.js';
import { search } from './tools/search.js';
import { symbol } from './tools/symbol.js';
import { uses } from './tools/uses.js';

/**
 * A source file is read once, by the parse that indexes it: the index keeps
 * the text of every doc, head and line an answer prints, so neither reading
 * the workspace nor answering about it opens the file again. Every read
 * JavaScript makes is counted by what it reads; the store and the manifests
 * are read there, which shows the count reaches the readers.
 */

const read = vi.hoisted(() => {
  const held = {
    sources: [] as string[],
    others: 0,
    count(path: unknown): void {
      const at = path instanceof URL ? path.pathname : typeof path === 'string' ? path : '';
      if (/\.(?:[cm]?[jt]sx?)$/u.test(at) && !at.includes('/node_modules/')) held.sources.push(at);
      else held.others += 1;
    },
  };
  return held;
});

vi.mock('node:fs', async (actual) => {
  const fs = await actual<typeof import('node:fs')>();
  const readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
    read.count(path);
    return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, readFileSync }, readFileSync };
});

vi.mock('node:fs/promises', async (actual) => {
  const fs = await actual<typeof import('node:fs/promises')>();
  const readFile = ((path: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
    read.count(path);
    return (fs.readFile as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFile;
  return { ...fs, default: { ...fs, readFile }, readFile };
});

let cache = '';
let previous: string | undefined;
const made: string[] = [];

beforeEach(() => {
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  cache = mkdtempSync(join(tmpdir(), 'va-read-once-cache-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  made.push(cache);
  read.sources = [];
  read.others = 0;
});

afterEach(() => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function checkout(files: Readonly<Record<string, string>>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-read-once-')));
  made.push(root);
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const WORKSPACE = {
  'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
  'packages/kit/package.json': JSON.stringify({ name: '@acme/kit', exports: './src/index.ts' }),
  'packages/kit/src/index.ts': "/** The kit. */\nexport * from './tax.js';\nexport { type Options } from './options.js';\n",
  'packages/kit/src/tax.ts': '/** A fifth of it. */\nexport function taxOf(amount: number): number {\n  return amount / 5;\n}\n',
  'packages/kit/src/options.ts': '/** How it runs. */\nexport interface Options {\n  /** Whether it runs in CI. */\n  readonly ci: boolean;\n}\n',
  'packages/app/package.json': JSON.stringify({ name: '@acme/app', dependencies: { '@acme/kit': '*' } }),
  'packages/app/src/main.ts': "import { taxOf, type Options } from '@acme/kit';\n\nexport const options: Options = { ci: false };\nexport const due = taxOf(10);\n",
};

describe('a source file read once', () => {
  it('is not read by JavaScript while the workspace is indexed and answered about', async () => {
    const root = checkout(WORKSPACE);
    const help = await readWorkspace(root);
    const answers = [
      symbol.run(help, { name: 'taxOf' }, { root }),
      symbol.run(help, { name: 'Options' }, { root }),
      uses.run(help, { name: 'taxOf' }, { root }),
      search.run(help, { query: 'fifth' }, { root }),
    ].map((answer) => JSON.stringify(answer));

    expect(answers.join('\n')).toContain('A fifth of it.');
    expect(answers.join('\n')).toContain('readonly ci: boolean');
    expect(read.sources).toEqual([]);
    expect(read.others).toBeGreaterThan(0);
  });

  it('is not read by JavaScript when a published generation is read again', async () => {
    const root = checkout(WORKSPACE);
    await readWorkspace(root);
    read.sources = [];
    read.others = 0;

    const help = await readWorkspace(root);
    symbol.run(help, { name: 'Options' }, { root });
    expect(read.sources).toEqual([]);
    expect(read.others).toBeGreaterThan(0);
  });
});
