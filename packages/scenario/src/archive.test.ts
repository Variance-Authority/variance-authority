import {
  CHROMIUM_PROFILE,
  digestValue,
  environmentKey,
  type SemanticSnapshot,
} from '@variance-authority/core/format';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createScenarioArchive, type ScenarioArchiveAddress } from './archive.js';
import { defineScenario, recordAct, startScenario } from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function snapshot(text: string): SemanticSnapshot {
  const environment = environmentKey({
    profile: 'chromium',
    engine: 'chromium@1',
    ruleset: 'rules@1',
    allowlist: 'allowlist@1',
    viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
    fonts: [],
    conditions: {},
    assets: {},
  });
  return {
    formatVersion: 1,
    subject: { id: 'page', kind: 'fixture' },
    profile: CHROMIUM_PROFILE,
    environment,
    renderHash: digestValue({ text }),
    structureHash: digestValue({ tag: 'main', text }),
    styleHash: digestValue({}),
    root: {
      path: '0',
      tag: 'main',
      attributes: {},
      style: {},
      rect: { x: 0, y: 0, width: 100, height: 40 },
      text,
      children: [],
    },
    styleProvenance: [],
    diagnostics: [],
  };
}

function run(id: string) {
  const definition = defineScenario('save-page', [{ key: 'save', kind: 'click' }]);
  const started = startScenario(
    definition,
    { id, precondition: { id: 'page', kind: 'fixture' }, profile: 'chromium' },
    snapshot('Ready'),
  );
  return recordAct(started, 'save', snapshot('Saved'));
}

function address(execution: string, attempt = '1'): ScenarioArchiveAddress {
  return {
    project: 'shop',
    run: 'run-1',
    scenario: 'save-page',
    execution,
    precondition: 'page',
    profile: 'chromium',
    attempt,
  };
}

const admitted = {
  retainUntil: '2030-01-01T00:00:00.000Z',
  access: 'project maintainers',
  deletion: 'expiry garbage collection',
  admit: () => ({ kind: 'admitted' as const }),
};

describe('the opt-in semantic scenario archive', () => {
  it('reopens an execution from a new archive instance and deduplicates equal snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-scenario-'));
    roots.push(root);
    await createScenarioArchive({ root }).put(address('execution-1'), run('execution-1'), admitted);
    await createScenarioArchive({ root }).put(
      { ...address('execution-2'), run: 'run-2' },
      run('execution-2'),
      admitted,
    );

    const reopened = await createScenarioArchive({ root }).read(address('execution-1'));
    expect(reopened.kind).toBe('observed');
    if (reopened.kind !== 'observed') throw new Error('expected archived execution');
    expect(reopened.run.execution.frames).toHaveLength(2);
    expect(await readdir(join(root, 'objects'))).toHaveLength(2);
    expect(JSON.stringify(reopened.manifest)).not.toContain('typedValue');
    expect(JSON.stringify(reopened.manifest)).not.toContain('raster');
  });

  it('reports expired evidence as unobserved and garbage-collects its objects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-scenario-'));
    roots.push(root);
    let now = new Date('2027-01-01T00:00:00.000Z');
    const archive = createScenarioArchive({ root, now: () => now });
    await archive.put(address('execution-1'), run('execution-1'), {
      ...admitted,
      retainUntil: '2027-02-01T00:00:00.000Z',
    });
    now = new Date('2027-03-01T00:00:00.000Z');

    await expect(archive.read(address('execution-1'))).resolves.toEqual({
      kind: 'unobserved',
      because: 'the archived scenario expired at 2027-02-01T00:00:00.000Z',
    });
    await expect(archive.collectExpired()).resolves.toEqual({ manifests: 1, snapshots: 2 });
  });

  it('refuses a semantic snapshot that retention policy cannot admit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-scenario-'));
    roots.push(root);
    const archive = createScenarioArchive({ root });

    await expect(
      archive.put(address('execution-1'), run('execution-1'), {
        ...admitted,
        admit: (candidate) =>
          candidate.root.text === 'Saved'
            ? { kind: 'refused', because: 'page text is secret-bearing' }
            : { kind: 'admitted' },
      }),
    ).rejects.toThrow('page text is secret-bearing');
    await expect(readdir(root)).resolves.toEqual([]);
  });
});
