import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { readHelp } from '../walk.js';
import { search } from './search.js';

/**
 * An exported name `search` finds is shown where it is declared and where it
 * is published from: the two sides of one export. A barrel that passes it on
 * is the door an importer walks through, and the declaring file is what the
 * reader came to read; a row naming only the barrel hides the declaration in a
 * count of files.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

async function workspace(): Promise<string> {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-search-declared-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-search-declared-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/kit/package.json': JSON.stringify({ name: 'kit' }),
    'packages/kit/src/chat/api.ts': '\n\nexport type ChatReplyShape = { text: string };\n',
    'packages/kit/src/chat/index.ts': "export type { ChatReplyShape } from './api.js';\n",
    'packages/kit/index.ts': "export const kit = 1;\nexport type { ChatReplyShape } from './src/chat/index.js';\n",
    'packages/kit/src/solo.ts': 'export const soloValue = 1;\n',
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  return root;
}

it('shows an exported name at its declaration and at the file it is published from', async () => {
  const root = await workspace();
  const out = search.run(readHelp(root), { query: 'ChatReplyShape' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('ChatReplyShape — '));
  expect(row, out).toBeDefined();
  expect(row).toContain('packages/kit/src/chat/api.ts:3');
  expect(row).toContain('packages/kit/index.ts:2');
  expect(row).not.toContain('more file');
});

it('shows a name its own file declares once, with no second place', async () => {
  const root = await workspace();
  const out = search.run(readHelp(root), { query: 'soloValue' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('soloValue — '));
  expect(row, out).toBe('soloValue — kit · packages/kit/src/solo.ts:1');
});
