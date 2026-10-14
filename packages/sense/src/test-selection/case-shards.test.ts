import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Format from './execution-set-format.js';
import { landCases, lastCaseRunOf } from './case-landing.js';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex, openSetExecutionIndex } from './execution-set-format.js';
import { writeTestCoverage } from './index.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('shard cases', () => {
  it('combines independent shard cases once, preserving durations and stopped cases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-case-shards-'));
    roots.push(root);
    const shards = [];
    for (let at = 0; at < 3; at += 1) {
      const file = `${at}.test.ts`;
      await writeFile(join(root, file), '');
      const tests = [{ id: `${file} > same`, file, name: 'same', stopped: at === 1, duration: at === 0 ? 0 : 12 * at,
        preconditions: at === 2 ? [] : undefined }];
      const sets = new CrossingSets(1);
      const called = sets.intern([0]);
      const index = encodeSetExecutionIndex({ tests, sets: sets.pool(), modules: [{ file: 'src/shared.ts',
        blocks: [{ kind: 'function', name: 'shared', path: 'shared', startLine: 1, endLine: 2, source: true }],
        called: Uint32Array.of(called), loaded: Uint8Array.of(1) }] });
      const coverage = { version: 3 as const, instrumentation: 'fixture', commit: 'same-run',
        tests: [{ file, complete: at !== 1, preconditions: [] }], modules: [] };
      const path = join(root, `${at}.bin`);
      await writeTestCoverage(path, coverage, { index, last: Buffer.from(JSON.stringify({ at: '', began: true,
        commit: 'same-run', files: [file], cases: tests.map(({ id }) => id) })) });
      shards.push({ path, coverage });
    }
    const writer = vi.spyOn(Format, 'writeSetColumns');
    const { sections, landing } = landCases(join(root, 'combined.bin'), {}, root, shards);
    expect(openSetExecutionIndex(sections.index!)!.tests).toEqual([
      { id: '0.test.ts > same', file: '0.test.ts', name: 'same', stopped: false, duration: 0 },
      { id: '1.test.ts > same', file: '1.test.ts', name: 'same', stopped: true, duration: 12 },
      { id: '2.test.ts > same', file: '2.test.ts', name: 'same', stopped: false, duration: 24, preconditions: [] },
    ]);
    expect(lastCaseRunOf(sections)?.cases).toHaveLength(3);
    expect(landing).toEqual({ laid: join(root, 'combined.bin'), shards: 3 });
    expect(writer).toHaveBeenCalledTimes(1);
  });
  it('keeps the before layer absent when independent shards started without a baseline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-no-base-'));
    roots.push(root);
    const shards = [];
    for (const file of ['a.test.ts', 'b.test.ts']) {
      await writeFile(join(root, file), '');
      const sets = new CrossingSets(1);
      sets.intern([]);
      const index = encodeSetExecutionIndex({ tests: [{ id: `${file} > one`, file, name: 'one' }], modules: [], sets: sets.pool() });
      const coverage = { version: 3 as const, instrumentation: 'fixture', commit: 'same-run', tests: [{ file, complete: true, preconditions: [] }], modules: [] };
      const path = join(root, `${file}.bin`);
      await writeTestCoverage(path, coverage, { index });
      shards.push({ path, coverage });
    }
    const { sections } = landCases(join(root, 'combined.bin'), {}, root, shards);
    expect(sections.before).toBeUndefined();
    expect(lastCaseRunOf(sections)?.beforeTexts).toBeUndefined();
    expect(lastCaseRunOf(sections)?.unbased).toEqual(['a.test.ts', 'b.test.ts']);
  });

});
