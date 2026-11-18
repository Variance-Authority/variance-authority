import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { affectedBy } from '@variance-authority/core/relate';
import { updateSourceIndex } from '../published.js';
import { publishedSelectionGraph } from '../published-selection.js';
import { taintFile, taintTable, type Taint } from './index.js';

let root: string;
let indexRoot: string;
let index: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-native-taint-'));
  indexRoot = await mkdtemp(join(tmpdir(), 'variance-native-taint-index-'));
  index = join(indexRoot, 'index.bin');
  for (const [file, source] of Object.entries({
    'src/api.ts': 'export const api = 1;',
    'src/panel.ts': 'export const panel = 1;',
    'src/theme.css': '.a{}',
    'src/card.ts': "import { api } from './api'; export const card = api;",
    'src/card.test.ts': "import { card } from './card'; export const test = card;",
    'src/relay.ts': 'export const relay = 1;',
    'outside/tool.ts': "import '../src/api';",
  })) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), source);
  }
  await updateSourceIndex(root, { index, dirs: ['src'] });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(indexRoot, { recursive: true, force: true });
});
const graph = (taints: readonly Taint[] = []) => publishedSelectionGraph(root, { dirs: ['src'], index, taints });

describe('configured taints over the native published graph', () => {
  it('shadows a module at every level and adds a declared load', async () => {
    const relations = await graph([taintTable('hand', {
      'src/card.test.ts': { '-': ['./api'] },
      'src/relay.ts': { '+': ['./panel'] },
    })]);
    expect(affectedBy(relations, ['src/api.ts']).files).not.toContain('src/card.test.ts');
    expect(affectedBy(relations, ['src/panel.ts']).files).toContain('src/relay.ts');
    expect(affectedBy(await graph(), ['src/api.ts']).files).toContain('src/card.test.ts');
  });

  it('uses the target kind for an added asset', async () => {
    const { native } = await graph([taintTable('asset', { 'src/relay.ts': { '+': ['./theme.css'] } })]);
    const [relay] = native.lookup([{ kind: 'file', name: 'src/relay.ts' }]);
    expect(native.rows([relay!.id], false)[0]!.edges).toContainEqual({ to: expect.objectContaining({ kind: 'file', name: 'src/theme.css' }), kind: 'asset' });
  });

  it('reports an unresolved relative addition as unknown', async () => {
    const { native } = await graph([taintTable('missing', { 'src/relay.ts': { '+': ['./missing', 'not-installed'] } })]);
    expect(native.lookup([{ kind: 'file', name: 'src/relay.ts' }])[0]?.unknown).toContain('./missing');
  });

  it('cuts nothing for a removal that resolves nowhere', async () => {
    const { native } = await graph([taintTable('missing', { 'src/relay.ts': { '-': ['./missing'] } })]);
    expect(native.shadows(['src/relay.ts'])).toEqual([[]]);
  });

  it('keeps an unscanned addition unknown rather than claiming it imports nothing', async () => {
    const { native } = await graph([taintTable('outside', { 'src/relay.ts': { '+': ['../outside/tool'] } })]);
    expect(native.lookup([{ kind: 'file', name: 'outside/tool.ts' }])[0]?.unknown).toContain('outside');
    expect(native.sources(['outside/tool.ts'])).toEqual([false]);
  });

  it('unions tables and lets a shadow apply to an addition', async () => {
    const relations = await graph([
      taintTable('add', { 'src/card.test.ts': { '+': ['./api', './panel'] } }),
      taintTable('shadow', { 'src/card.test.ts': { '-': ['./api'] } }),
    ]);
    expect(affectedBy(relations, ['src/api.ts']).files).not.toContain('src/card.test.ts');
    expect(affectedBy(relations, ['src/panel.ts']).files).toContain('src/card.test.ts');
  });

  it('reads a configured JSON table under its file name', async () => {
    const file = join(indexRoot, 'taint.json');
    await writeFile(file, JSON.stringify({ 'src/relay.ts': { '+': ['./panel'] } }));
    const taint = await taintFile(file);
    expect(taint.name).toBe(file);
    expect(affectedBy(await graph([taint]), ['src/panel.ts']).files).toContain('src/relay.ts');
  });

  it('refuses a JSON value that cannot be a table', async () => {
    const file = join(indexRoot, 'invalid.json');
    await writeFile(file, '[]');
    await expect(taintFile(file)).rejects.toThrow('not a taint table');
  });
});
