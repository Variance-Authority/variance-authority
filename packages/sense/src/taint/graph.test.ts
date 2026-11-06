import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { affectedBy, type FileRecord } from '@variance-authority/core/relate';
import { scanRelations } from '../scan.js';
import { runGraphOf } from './graph.js';
import { taintTable } from './index.js';

describe('runGraphOf', () => {
  let root: string;
  let records: readonly FileRecord[];

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
    records = await scanRelations({ root, dirs: ['.'], digests: false });
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it('reads the mocks unasked: a change behind a mock does not reach the file that mocked it', async () => {
    const moved = affectedBy(await runGraphOf(records, { root }), ['api.ts']).files;

    expect(moved).toContain('real.test.ts');
    expect(moved).not.toContain('mocked.test.ts');
  });

  it('keeps the edge of a factory that loads the original through its first parameter, whatever its name', async () => {
    const moved = affectedBy(await runGraphOf(records, { root }), ['api.ts']).files;

    expect(moved).toContain('original.test.ts');
  });

  it('joins a configured taint after the mocks', async () => {
    const taints = [taintTable('loads', { 'loads.test.ts': { '+': ['./panel'] } })];
    const moved = affectedBy(await runGraphOf(records, { root, taints }), ['panel.ts']).files;

    expect(moved).toContain('loads.test.ts');
  });

  it('reads an edge a taint added as used whole, and asks the caller about every other', async () => {
    const taints = [taintTable('loads', { 'loads.test.ts': { '+': ['./panel'] } })];
    const relations = await runGraphOf(records, { root, taints, uses: () => ({ imports: ['api'] }) });

    expect(relations.uses?.('loads.test.ts', 'panel.ts')).toBeUndefined();
    expect(relations.uses?.('real.test.ts', 'api.ts')).toEqual({ imports: ['api'] });
  });
});
