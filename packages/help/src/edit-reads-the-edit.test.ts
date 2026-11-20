import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as sense from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspace } from './read.js';
import { symbol } from './tools/symbol.js';

/**
 * A question asked after a one-file edit reads that file again and nothing
 * else: the index's update finds what moved from git and re-reads it, so the
 * read costs the edit, not the repository.
 */

vi.mock('@variance-authority/sense', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense')>();
  return { ...actual, updateSourceIndex: vi.fn(actual.updateSourceIndex) };
});

let previous: string | undefined;
const made: string[] = [];

beforeEach(() => {
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  const cache = mkdtempSync(join(tmpdir(), 'va-edit-reads-cache-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  made.push(cache);
});

afterEach(() => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const WORKSPACE = {
  'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
  'packages/kit/package.json': JSON.stringify({ name: '@acme/kit', exports: './src/index.ts' }),
  'packages/kit/src/index.ts': "export * from './tax.js';\nexport * from './rate.js';\n",
  'packages/kit/src/tax.ts': '/** A fifth of it. */\nexport function taxOf(amount: number): number {\n  return amount / 5;\n}\n',
  'packages/kit/src/rate.ts': 'export const rate = 5;\n',
  'packages/app/package.json': JSON.stringify({ name: '@acme/app', dependencies: { '@acme/kit': '*' } }),
  'packages/app/src/main.ts': "import { taxOf } from '@acme/kit';\n\nexport const due = taxOf(10);\n",
};

function checkout(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-edit-reads-')));
  made.push(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch', 'main');
  for (const [path, text] of Object.entries(WORKSPACE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
  return root;
}

describe('a question after a one-file edit', () => {
  it('reads the edited file again and no other', async () => {
    const root = checkout();
    await readWorkspace(root);
    appendFileSync(join(root, 'packages/kit/src/tax.ts'), '/** A tenth of it. */\nexport const tithe = (amount: number): number => amount / 10;\n');
    vi.mocked(sense.updateSourceIndex).mockClear();

    const help = await readWorkspace(root);

    const updates = await Promise.all(vi.mocked(sense.updateSourceIndex).mock.results.map((result) => result.value as Promise<sense.SourceUpdate>));
    expect(updates.map((update) => update.reread), 'what each update read again').toEqual([1]);
    expect(JSON.stringify(symbol.run(help, { name: 'tithe' }, { root }))).toContain('A tenth of it.');
  });
});
