import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import * as sense from '@variance-authority/sense';
import { settleFollowUps } from './index-follow-ups.js';
import { encodeExecutionIndex, readTestCoverage, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { main, parseArgs } from '../bin.js';
import * as selection from '@variance-authority/sense/test-selection';
import { distillRows } from './distill.js';
import { readExecutionIndex } from './execution-input.js';
import { recordedJourneys } from './resources.js';

vi.mock('./resources.js', async (original) => ({
  ...await original<typeof import('./resources.js')>(),
  recordedJourneys: vi.fn(() => { throw new Error('merge must not compute a journey comparison'); }),
}));

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'va-merge-command-')));
  temporary.push(root);
  await mkdir(join(root, 'src'));
  const source = 'export function greet() { return "hello"; }\n';
  await writeFile(join(root, 'src/greet.ts'), source);
  const shards: string[] = [];
  for (const name of ['a', 'b']) {
    const file = `${name}.test.ts`;
    await writeFile(join(root, file), 'it("greets", () => {});\n');
    const path = join(root, `${name}.bin`);
    const test = { id: `${file} > greets`, file, name: 'greets', stopped: false };
    const blocks = [
      { ordinal: 0, kind: 'module' as const, digest: 'module', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [], loadedBy: [file] },
      { ordinal: 1, owner: 0, kind: 'function' as const, digest: 'function', name: 'greet', path: 'greet', startLine: 1, endLine: 1, source: true, testFiles: [file] },
    ];
    await writeTestCoverage(path, {
      version: 3, instrumentation: 'fixture',
      tests: [{ file, complete: true, preconditions: [] }],
      modules: [{ file: 'src/greet.ts', sourceDigest: digestString(source), instrumented: true, blocks }],
    }, { index: encodeExecutionIndex({ tests: [test], modules: [{ file: 'src/greet.ts', blocks: blocks.map((block) => ({
      ...block, crossings: block.kind === 'function' ? [{ test: 0, distance: 0 }] : [],
    })) }] }) });
    shards.push(path);
  }
  return { root, shards, into: join(root, 'combined.bin') };
}

describe('`journeys merge`', () => {
  it('lands coverage and cases without project configuration or a comparison, from the named checkout', async () => {
    const { root, shards, into } = await fixture();
    const before = (await Promise.all(shards.map((execution) => distillRows({ root, execution })))).flatMap((read) => read.rows);
    let out = '';
    let err = '';
    const code = await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], {
      out: (text) => { out += text; }, err: (text) => { err += text; },
    });

    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(out).toContain(`folded 2 snapshots into ${into}`);
    expect(out).not.toContain('pool:');
    expect(recordedJourneys).not.toHaveBeenCalled();
    expect((await readTestCoverage(into)).modules[0]!.blocks[0]!.loadedBy).toEqual(['a.test.ts', 'b.test.ts']);
    expect((await readExecutionIndex(into)).tests.map((test) => test.id)).toEqual(['a.test.ts > greets', 'b.test.ts > greets']);
    expect((await distillRows({ root, execution: into })).rows).toEqual(before);
  });

  it('combines only the named artifacts without decoding coverage or seeding a cache baseline', async () => {
    const { root, shards, into } = await fixture();
    await writeTestCoverage(into, { version: 3, instrumentation: 'fixture',
      tests: [{ file: 'old.test.ts', complete: true, preconditions: [] }], modules: [] });
    const decode = vi.spyOn(selection, 'readTestCoverage').mockImplementation(async () => { throw new Error('artifact merge must stay on stored columns'); });
    const seed = vi.spyOn(selection, 'seedTestCoverage').mockImplementation(async () => { throw new Error('artifact merge must not seed a baseline'); });
    let err = '';
    const code = await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], {
      out: () => undefined, err: (text) => { err += text; },
    });
    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(decode).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
    decode.mockRestore();
    expect((await readTestCoverage(into)).tests.map(({ file }) => file)).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('reports the planned work for coverage, cases and output separately', async () => {
    const { root, shards, into } = await fixture();
    const stages: string[] = [];
    const code = await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], {
      out: () => undefined, err: () => undefined, progress: (label) => stages.push(label),
    });
    expect(code).toBe(0);
    expect(stages).toEqual([
      'reading metadata from 2 shard records', 'folding coverage from 2 shard records',
      'combining cases from 2 shards (2 observations, 1 modules)', 'writing combined record (1 MiB)',
    ]);
  });

  it('preserves recorded cases when their test files are absent from the current checkout', async () => {
    const { root, shards, into } = await fixture();
    await Promise.all(['a.test.ts', 'b.test.ts'].map((file) => rm(join(root, file))));
    const code = await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], {
      out: () => undefined, err: () => undefined,
    });
    expect(code).toBe(0);
    expect((await readExecutionIndex(into)).tests.map(({ id }) => id)).toEqual(['a.test.ts > greets', 'b.test.ts > greets']);
  });

  it('replaces an old output when every named artifact records an empty case index', async () => {
    const { root, shards, into } = await fixture();
    await writeTestCoverage(into, { version: 3, instrumentation: 'old', tests: [{ file: 'old.test.ts', complete: true, preconditions: [] }], modules: [] });
    for (const path of shards) await selection.writeCoverageBytes(path, selection.recordOfCases({ index: encodeExecutionIndex({ tests: [], modules: [] }) }));
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: () => undefined })).toBe(0);
    await expect(readTestCoverage(into)).rejects.toBeInstanceOf(selection.RecordWithoutCoverage);
    expect((await readExecutionIndex(into)).tests).toEqual([]);
  });

  it('replaces stale output runs metadata when named artifacts supply only cases', async () => {
    const { root, shards, into } = await fixture();
    await selection.writeCommitRuns(selection.commitRunsFile(into), { commit: 'old-commit', first: 'then', latest: 'then', runs: 1, files: ['old.test.ts'] });
    for (const path of shards) {
      const index = selection.caseSectionsAt(path).index!;
      await selection.writeCoverageBytes(path, selection.recordOfCases({ index }));
    }
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: () => undefined })).toBe(0);
    expect(await selection.readCommitRuns(into)).toBeUndefined();
  });

  it('refuses an unreadable recorded case index instead of treating it as absent', async () => {
    const { root, shards, into } = await fixture();
    const kept = selection.caseSectionsAt(shards[0]!);
    await selection.writeCoverageBytes(shards[0]!, selection.recordOfCases({ ...kept, index: Uint8Array.of(1, 2, 3) }));
    let err = '';
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: (text) => { err += text; } })).toBe(2);
    expect(err).toContain('cannot combine a recorded case index');
  });

  it('retains unwalked regions and modules recorded by earlier artifacts', async () => {
    const { root, shards, into } = await fixture();
    const region = (name: string, crossings: readonly { test: number; distance: number }[]) => ({ kind: 'function', name, path: name, startLine: 1, endLine: 1, source: true, crossings });
    await selection.writeCoverageBytes(shards[0]!, selection.recordOfCases({ index: encodeExecutionIndex({ tests: [], modules: [
      { file: 'src/greet.ts', blocks: [region('unwalked', [])] }, { file: 'src/empty.ts', blocks: [region('only-before', [])] },
    ] }) }));
    await selection.writeCoverageBytes(shards[1]!, selection.recordOfCases({ index: encodeExecutionIndex({ tests: [{ id: 'case', file: 'same.test.ts', name: 'case' }], modules: [
      { file: 'src/greet.ts', blocks: [region('walked', [{ test: 0, distance: 0 }])] },
    ] }) }));
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: () => undefined })).toBe(0);
    const joined = await readExecutionIndex(into);
    expect(joined.modules.map((module) => [module.file, module.blocks.map((block) => block.name)])).toEqual([
      ['src/empty.ts', ['only-before']], ['src/greet.ts', ['walked', 'unwalked']],
    ]);
  });

  it.each(['absent', 'one', 'partial'])('carries only explicitly recorded before sections: %s', async (before) => {
    const { root, shards, into } = await fixture();
    for (const [at, path] of shards.entries()) {
      const kept = selection.caseSectionsAt(path);
      const cut = encodeExecutionIndex({ tests: [{ id: `old-${at}`, file: 'same.test.ts', name: `old-${at}` }], modules: [] });
      await selection.writeCoverageBytes(path, selection.recordOfCases({ ...kept, ...(before === 'partial' || before === 'one' && at === 0 ? { before: cut } : {}) }));
    }
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: () => undefined })).toBe(0);
    const kept = selection.caseSectionsAt(into);
    if (before === 'absent') expect(kept.before).toBeUndefined();
    else expect(selection.decodeExecutionIndex(kept.before!)!.tests.map((test) => test.id)).toEqual(before === 'one' ? ['old-0'] : ['old-0', 'old-1']);
  });

  it.each(['same case', 'different cases'])('unions completed artifact shards from one test file: %s', async (identity) => {
    const { root, shards, into } = await fixture();
    for (const [at, path] of shards.entries()) {
      const name = identity === 'same case' ? 'shared' : `case-${at}`;
      const index = encodeExecutionIndex({ tests: [{ id: `same.test.ts > ${name}`, file: 'same.test.ts', name, duration: 10 + at, stopped: at === 0 }], modules: [{ file: 'src/greet.ts', blocks: [{
        kind: 'function', name: `region-${at}`, path: `region-${at}`, startLine: at + 1, endLine: at + 1, source: true, crossings: [{ test: 0, distance: 0 }],
      }] }] });
      await selection.writeCoverageBytes(path, selection.recordOfCases({ index }));
    }
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: () => undefined })).toBe(0);
    const joined = await readExecutionIndex(into);
    expect(joined.tests).toHaveLength(identity === 'same case' ? 1 : 2);
    expect(joined.modules[0]!.blocks.map((block) => block.crossings.length)).toEqual([1, 1]);
    if (identity === 'same case') expect(joined.tests[0]).toMatchObject({ duration: 21, stopped: false });
  });

  it('combines case-only shard crossings without treating absent source digests as an edit', async () => {
    const { root, shards, into } = await fixture();
    for (const [at, path] of shards.entries()) {
      const file = `${at === 0 ? 'a' : 'b'}.test.ts`;
      const index = encodeExecutionIndex({ tests: [{ id: `${file} > greets`, file, name: 'greets' }], modules: [{ file: 'src/greet.ts', blocks: [{
        kind: 'function', name: 'greet', path: 'greet', startLine: 1, endLine: 1, source: true, crossings: [{ test: 0, distance: 0 }],
      }] }] });
      await selection.writeCoverageBytes(path, selection.recordOfCases({ index }));
    }
    let err = '';
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: (text) => { err += text; } })).toBe(0);
    expect(err).toBe('');
    const joined = await readExecutionIndex(into);
    expect(joined.modules[0]!.blocks[0]!.crossings.map(({ test }) => joined.tests[test]!.file)).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it.each([0, 1])('combines an unknown digest with a named digest in either shard order: %s', async (caseOnly) => {
    const { root, shards, into } = await fixture();
    const index = selection.caseSectionsAt(shards[caseOnly]!).index!;
    await selection.writeCoverageBytes(shards[caseOnly]!, selection.recordOfCases({ index }));
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: () => undefined })).toBe(0);
    const joined = await readExecutionIndex(into);
    expect(joined.modules[0]!.blocks[1]!.crossings.map(({ test }) => joined.tests[test]!.file)).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('preserves different partial case cuts when no source digest establishes an edit', async () => {
    const { root, shards, into } = await fixture();
    for (const [at, path] of shards.entries()) {
      const file = `${at === 0 ? 'a' : 'b'}.test.ts`;
      const index = encodeExecutionIndex({ tests: [{ id: `${file} > greets`, file, name: 'greets' }], modules: [{ file: 'src/greet.ts', blocks: [{
        kind: 'function', name: 'greet', path: 'greet', startLine: at + 1, endLine: at + 1, source: true, crossings: [{ test: 0, distance: 0 }],
      }] }] });
      await selection.writeCoverageBytes(path, selection.recordOfCases({ index }));
    }
    let err = '';
    expect(await main(['journeys', 'merge', ...shards, '--into', into, '--root', root], { out: () => undefined, err: (text) => { err += text; } })).toBe(0);
    expect(err).toBe('');
    const joined = await readExecutionIndex(into);
    expect(joined.modules[0]!.blocks.map((block) => ({ line: block.startLine, files: block.crossings.map(({ test }) => joined.tests[test]!.file) }))).toEqual([
      { line: 2, files: ['b.test.ts'] }, { line: 1, files: ['a.test.ts'] },
    ]);
  });

  it('defaults the source root to the working directory and resolves paths there', () => {
    expect(parseArgs(['journeys', 'merge', 'one.bin', '--into', 'all.bin'])).toMatchObject({
      command: 'journeys', operation: 'merge', root: process.cwd(), shards: [resolve('one.bin')], into: resolve('all.bin'),
    });
  });

  it('keeps relative shard and output paths at the working directory with an explicit source root', () => {
    expect(parseArgs(['journeys', 'merge', 'one.bin', '--into', 'all.bin', '--root', 'checkout'])).toMatchObject({
      root: resolve('checkout'), shards: [resolve('one.bin')], into: resolve('all.bin'),
    });
  });

  it.each([
    ['merge'], ['merge', 'one.bin'], ['merge', '--into', 'all.bin'],
    ['merge', 'one.bin', '--into', 'all.bin', '--suite', 'unit'],
    ['merge', 'one.bin', '--into', 'all.bin', '--all'],
    ['merge', 'one.bin', '--into', 'all.bin', '--config', 'web.json'],
  ])('refuses incomplete or reading-specific arguments: %j', (...args) => {
    expect(() => parseArgs(['journeys', ...args])).toThrow('`variance journeys merge`');
  });

  it.each(['stitch', 'finalize', 'one.bin'])('refuses --root outside merge: %s', (operation) => {
    expect(() => parseArgs(['journeys', operation, '--root', '/repo'])).toThrow();
  });
});


describe('journey artifact operations', () => {
  it.each([
    ['merge', 'one.bin', '--into', 'all.bin'],
    ['finalize', 'one.bin'],
    ['stitch', 'one.bin', '--into', 'all.bin'],
  ])('does not consult an index before %s', async (...args) => {
    const index = vi.spyOn(sense, 'sourceIndexPath').mockImplementation(() => {
      throw new Error('artifact operations must not consult or prepare the source index');
    });
    const err = vi.fn();

    await settleFollowUps(parseArgs(['journeys', ...args]), { err });

    expect(index).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});
