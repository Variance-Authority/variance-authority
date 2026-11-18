import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { affectedBy } from '@variance-authority/core/relate';
import { updateSourceIndex } from '../published.js';
import { publishedSelectionGraph } from '../published-selection.js';
import { taintTable } from './index.js';

describe('the published native run graph', () => {
  let root: string;
  let index: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-run-graph-'));
    await Promise.all([
      writeFile(join(root, 'api.ts'), 'export const api = 1;'),
      writeFile(join(root, 'panel.ts'), 'export const panel = 1;'),
      writeFile(join(root, 'real.test.ts'), "import { api } from './api';"),
      writeFile(join(root, 'mocked.test.ts'), "import { api } from './api'; vi.mock('./api');"),
      writeFile(join(root, 'loads.test.ts'), "export const loads = 1;"),
      writeFile(join(root, 'original.test.ts'), "import { api } from './api'; vi.mock('./api', async (original) => ({ ...(await original()) }));"),
    ]);
    index = join(await mkdtemp(join(tmpdir(), 'variance-run-index-')), 'index.bin');
    await updateSourceIndex(root, { index });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(join(index, '..'), { recursive: true, force: true });
  });

  it('reads the mocks unasked: a change behind a mock does not reach the file that mocked it', async () => {
    const moved = affectedBy(await publishedSelectionGraph(root, { dirs: ['.'], index }), ['api.ts']).files;

    expect(moved).toContain('real.test.ts');
    expect(moved).not.toContain('mocked.test.ts');
  });

  it('keeps the edge of a factory that loads the original through its first parameter, whatever its name', async () => {
    const moved = affectedBy(await publishedSelectionGraph(root, { dirs: ['.'], index }), ['api.ts']).files;

    expect(moved).toContain('original.test.ts');
  });

  it('joins a configured taint after the mocks', async () => {
    const taints = [taintTable('loads', { 'loads.test.ts': { '+': ['./panel'] } })];
    const moved = affectedBy(await publishedSelectionGraph(root, { dirs: ['.'], index, taints }), ['panel.ts']).files;

    expect(moved).toContain('loads.test.ts');
  });

  it('reads a configured addition as used whole and keeps parsed bindings on ordinary imports', async () => {
    const taints = [taintTable('loads', { 'loads.test.ts': { '+': ['./panel'] } })];
    const { native } = await publishedSelectionGraph(root, { dirs: ['.'], index, taints });
    const nodes = native.lookup(['loads.test.ts', 'panel.ts', 'real.test.ts', 'api.ts'].map((name) => ({ kind: 'file', name })));
    const uses = native.uses([{ importer: nodes[0]!.id, target: nodes[1]!.id }, { importer: nodes[2]!.id, target: nodes[3]!.id }]);
    expect(uses[0]).toBeNull();
    expect(uses[1]).toMatchObject({ imports: ['api'] });
  });
});
