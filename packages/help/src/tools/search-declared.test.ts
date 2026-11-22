import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { readWorkspaceForAnswer } from '../read.js';
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
    'index.ts': "export * from './packages/kit/index.js';\n",
    // A bare `kit` resolves the way Kibana's `@kbn/*` do: through `paths`.
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { kit: ['packages/kit/index.ts'], 'kit/*': ['packages/kit/*'] } } }),
    'packages/kit/package.json': JSON.stringify({ name: 'kit' }),
    'packages/kit/src/chat/api.ts': '\n\nexport type ChatReplyShape = { text: string };\n',
    'packages/kit/src/chat/index.ts': "export type { ChatReplyShape } from './api.js';\n",
    'packages/kit/index.ts': "export const kit = 1;\nexport type { ChatReplyShape } from './src/chat/index.js';\n",
    'packages/kit/src/solo.ts': 'export const soloValue = 1;\n',
    'packages/kit/src/deep/thing.ts': 'export const starThing = 1;\n',
    'packages/kit/src/deep/index.ts': "export * from './thing.js';\n",
    'packages/kit/star.ts': "export * from './src/deep/index.js';\n",
    'packages/other/package.json': JSON.stringify({ name: 'other' }),
    'packages/kit/src/shared.ts': 'export const sharedThing = 1;\n',
    'packages/aa/package.json': JSON.stringify({ name: 'aa' }),
    'packages/aa/index.ts': "export { sharedThing } from '../kit/src/shared.js';\n",
    'packages/other/src/re.ts': "export type { ChatReplyShape } from '../../kit/src/chat/api.js';\n",
    'packages/other/src/use.ts': "import type { ChatReplyShape } from 'kit';\nimport { starThing } from 'kit/star';\nexport const used: ChatReplyShape | number = starThing;\n",
    'packages/kit/src/lone/thing.ts': 'export const loneThing = 1;\n',
    'packages/kit/src/lone/index.ts': "export { loneThing } from './thing.js';\n",
    'packages/kit/src/alias/base.ts': 'export const baseValue = 1;\n',
    'packages/aa/alias.ts': "export { baseValue as renamedValue } from '../kit/src/alias/base.js';\n",
    'packages/kit/src/twin.ts': 'export const twinValue = 1;\n',
    'packages/other/src/twin.ts': 'export const twinValue = 2;\n',
    'packages/kit/src/said/thing.ts': 'export const saidThing = 1;\n',
    'packages/kit/src/said/index.ts': "/** Paints zebra stripes. */\nexport { saidThing } from './thing.js';\n",
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
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'ChatReplyShape' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('ChatReplyShape — '));
  expect(row, out).toBeDefined();
  expect(row).toBe('ChatReplyShape — kit · packages/kit/src/chat/api.ts:3 · exported from packages/kit/index.ts:2');
});

it('shows the file another package enters through `export *` at, with no line', async () => {
  const root = await workspace();
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'starThing' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('starThing — '));
  expect(row, out).toBe('starThing — kit · packages/kit/src/deep/thing.ts:1 · exported from packages/kit/star.ts');
});

it('keeps the count of exporting files when no source index walks to the declaration', async () => {
  const root = await workspace();
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'ChatReplyShape' }, {});
  const row = out.split('\n').find((line) => line.startsWith('ChatReplyShape — '));
  expect(row, out).toMatch(/ \(\+3 more files\)$/);
});

it('shows a name its own file declares once, with no second place', async () => {
  const root = await workspace();
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'soloValue' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('soloValue — '));
  expect(row, out).toBe('soloValue — kit · packages/kit/src/solo.ts:1');
});

it('names the package that declares a name another package passes on', async () => {
  const root = await workspace();
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'sharedThing' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('sharedThing — '));
  expect(row, out).toBe('sharedThing — kit · packages/kit/src/shared.ts:1');
});

it('names no door when no other package enters the declaring package through a file that passes the name on', async () => {
  const root = await workspace();
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'loneThing' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('loneThing — '));
  expect(row, out).toBe('loneThing — kit · packages/kit/src/lone/thing.ts:1');
});

it('keeps a renamed re-export at its own row, since the declaration is written under another name', async () => {
  const root = await workspace();
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'renamedValue' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('renamedValue — '));
  expect(row, out).toBe('renamedValue — aa · packages/aa/alias.ts:1');
});

it('keeps the count of files that export a second declaration of the same name', async () => {
  const root = await workspace();
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'twinValue' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('twinValue — '));
  expect(row, out).toMatch(/^twinValue — \S+ · packages\/\S+\/src\/twin\.ts:1 \(\+1 more file\)$/);
});

it('keeps the summary of the comment a doc search matched, when that comment sits on a re-export', async () => {
  const root = await workspace();
  const out = search.run(await readWorkspaceForAnswer(root), { query: 'zebra stripes' }, { root });
  const row = out.split('\n').find((line) => line.startsWith('saidThing — '));
  expect(row, out).toBe('saidThing — kit · packages/kit/src/said/thing.ts:1 — Paints zebra stripes.');
});
