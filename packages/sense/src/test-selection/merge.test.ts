// Where an index stands after two runs are folded together, what N shards of one
// run fold into, and what a reader does with a file it cannot decode at all.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { existingCoverage, foldTestCoverage, mergeCoverage } from './merge.js';
import type { TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';

function at(commit: string | undefined, test: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    ...(commit === undefined ? {} : { commit }),
    tests: [{ file: test, complete: true, preconditions: [{ name: test, digest: 'source:test' }] }],
    modules: [
      {
        file: 'src/decide.ts',
        sourceDigest: 'source:decide',
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: 'block:decide',
            name: '',
            path: 'module',
            startLine: 1,
            endLine: 8,
            source: true,
            testFiles: [test],
          },
        ],
      },
    ],
  };
}

describe('mergeCoverage', () => {
  it('stands where the run that just happened stands', () => {
    // A local layer over a baseline is the ordinary shape, so the two sides
    // naming different commits is not a conflict. The question a later reader
    // asks is what has changed since this index was last written, and that is
    // answered by the newer of the two and never by the one underneath it.
    const merged = mergeCoverage(at(BASELINE, 'test/alpha.test.ts'), at(LOCAL, 'test/beta.test.ts'));

    expect(merged.commit).toBe(LOCAL);
    expect(merged.tests.map((test) => test.file)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('leaves an index unpositioned when the run that wrote it was', () => {
    expect(mergeCoverage(at(BASELINE, 'test/alpha.test.ts'), at(undefined, 'test/beta.test.ts')))
      .not.toHaveProperty('commit');
  });

  it('demotes a carried test whose region changed under it', () => {
    // A full run saw alpha enter the module region. One file was then run by
    // hand over an edit to that region. Alpha was not re-recorded, so its
    // crossing cannot be kept as evidence about the new region — and dropping
    // it while calling alpha whole would let the next diff of that region skip
    // the one test known to have reached it.
    const merged = mergeCoverage(
      at(BASELINE, 'test/alpha.test.ts'),
      rewritten(at(LOCAL, 'test/beta.test.ts'), 'block:decide-edited'),
    );

    expect(merged.tests).toEqual([
      expect.objectContaining({ file: 'test/alpha.test.ts', complete: false }),
      expect.objectContaining({ file: 'test/beta.test.ts', complete: true }),
    ]);
    expect(merged.modules[0]?.blocks[0]?.testFiles).toEqual(['test/beta.test.ts']);
  });

  it('keeps a carried test whole when its regions are the ones it saw', () => {
    const merged = mergeCoverage(at(BASELINE, 'test/alpha.test.ts'), at(LOCAL, 'test/beta.test.ts'));

    expect(merged.tests.every((test) => test.complete)).toBe(true);
    expect(merged.modules[0]?.blocks[0]?.testFiles).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('demotes a carried test whose region is gone', () => {
    const current = at(LOCAL, 'test/beta.test.ts');
    const merged = mergeCoverage(at(BASELINE, 'test/alpha.test.ts'), {
      ...current,
      modules: [{ ...current.modules[0]!, blocks: [] }],
    });

    expect(merged.tests.find((test) => test.file === 'test/alpha.test.ts')?.complete).toBe(false);
  });

  it('demotes a carried test whose module has other text on disk than its rows were recorded over', () => {
    // A full run recorded the module at one commit. A file was then run by
    // hand at a later commit that moved the module's lines, without loading
    // it. The index now stands at the later commit and the carried rows are
    // ranges in text nobody has; the test that entered them runs regardless.
    const merged = mergeCoverage(
      at(BASELINE, 'test/alpha.test.ts'),
      { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
      new Map([['src/decide.ts', 'source:decide-moved']]),
    );

    expect(merged.tests.find((test) => test.file === 'test/alpha.test.ts')?.complete).toBe(false);
    expect(merged.modules[0]?.blocks[0]?.testFiles).toEqual(['test/alpha.test.ts']);
  });

  it('leaves a carried test whole when the run did not load its modules', () => {
    // A module the run never loaded is carried as it was; nothing changed
    // under anybody there that this run could know about.
    const current = at(LOCAL, 'test/beta.test.ts');
    const merged = mergeCoverage(
      at(BASELINE, 'test/alpha.test.ts'),
      { ...current, modules: [] },
      new Map([['src/decide.ts', 'source:decide']]),
    );

    expect(merged.tests.every((test) => test.complete)).toBe(true);
    expect(merged.modules[0]?.blocks[0]?.testFiles).toEqual(['test/alpha.test.ts']);
  });
});

/** The same snapshot after the module's one region was edited. */
function rewritten(coverage: TestCoverage, digest: string): TestCoverage {
  return {
    ...coverage,
    modules: coverage.modules.map((module) => ({
      ...module,
      sourceDigest: `${module.sourceDigest}-edited`,
      blocks: module.blocks.map((block) => ({ ...block, digest })),
    })),
  };
}

describe('foldTestCoverage', () => {
  /** One shard: its own test file whole, and `src/decide.ts` entered by it. */
  const shard = (path: string, test: string, commit = BASELINE) => ({
    path,
    coverage: at(commit, test),
  });

  it('is the snapshot the unsharded run would have written, in any order', () => {
    // Two shards of one run each hold one test file and both loaded the same
    // module. The union names both tests on the region, and names them the same
    // way whichever shard is read first: a fan-in that depended on order would
    // be a layer, and a layer retires what the later side re-recorded.
    const alpha = shard('shard-1/coverage.bin', 'test/alpha.test.ts');
    const beta = shard('shard-2/coverage.bin', 'test/beta.test.ts');

    const folded = foldTestCoverage([alpha, beta]);

    expect(folded.commit).toBe(BASELINE);
    expect(folded.tests.map((test) => test.file)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
    expect(folded.modules).toHaveLength(1);
    expect(folded.modules[0]!.blocks[0]!.testFiles).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
    expect(foldTestCoverage([beta, alpha])).toEqual(folded);
  });

  it('carries a module only one shard loaded, with only that shard\'s crossings', () => {
    const alpha = shard('shard-1/coverage.bin', 'test/alpha.test.ts');
    const beta = shard('shard-2/coverage.bin', 'test/beta.test.ts');
    const only = {
      ...beta,
      coverage: {
        ...beta.coverage,
        modules: beta.coverage.modules.map((module) => ({ ...module, file: 'src/only.ts' })),
      },
    };

    const folded = foldTestCoverage([alpha, only]);

    expect(folded.modules.map((module) => module.file)).toEqual(['src/decide.ts', 'src/only.ts']);
    expect(folded.modules[0]!.blocks[0]!.testFiles).toEqual(['test/alpha.test.ts']);
    expect(folded.modules[1]!.blocks[0]!.testFiles).toEqual(['test/beta.test.ts']);
  });

  it('lets a shard that could not instrument a module outvote the ones that could', () => {
    // The row that says *this build never measured this module* is the one a
    // reader widens on. A fold where the measured shards won would turn that
    // unknown into a narrowing nobody recorded.
    const alpha = shard('shard-1/coverage.bin', 'test/alpha.test.ts');
    const beta = shard('shard-2/coverage.bin', 'test/beta.test.ts');
    const unread = {
      ...beta,
      coverage: {
        ...beta.coverage,
        modules: beta.coverage.modules.map((module) => ({ ...module, instrumented: false, blocks: [] })),
      },
    };

    const [module] = foldTestCoverage([alpha, unread]).modules;

    expect(module).toMatchObject({ file: 'src/decide.ts', instrumented: false, blocks: [] });
    expect(foldTestCoverage([unread, alpha]).modules[0]).toEqual(module);
  });

  it('refuses shards that disagree about where they stand, by name', () => {
    expect(() =>
      foldTestCoverage([
        shard('shard-1/coverage.bin', 'test/alpha.test.ts', BASELINE),
        shard('shard-2/coverage.bin', 'test/beta.test.ts', LOCAL),
      ]),
    ).toThrow(/shard-1\/coverage\.bin and shard-2\/coverage\.bin disagree about the commit/);

    // Absent is a value. A shard recorded outside a checkout cannot say where
    // it stands, and folding it under a commit it never named would.
    expect(() =>
      foldTestCoverage([
        shard('shard-1/coverage.bin', 'test/alpha.test.ts', BASELINE),
        { path: 'shard-2/coverage.bin', coverage: at(undefined, 'test/beta.test.ts') },
      ]),
    ).toThrow(/disagree about the commit .*\(none\)/);
  });

  it('refuses shards recorded under different probe recipes, by name', () => {
    const alpha = shard('shard-1/coverage.bin', 'test/alpha.test.ts');
    const beta = shard('shard-2/coverage.bin', 'test/beta.test.ts');

    expect(() =>
      foldTestCoverage([
        alpha,
        { ...beta, coverage: { ...beta.coverage, instrumentation: 'other-instrumentation' } },
      ]),
    ).toThrow(/disagree about the instrumentation/);
  });

  it('refuses a test file two shards both recorded', () => {
    expect(() =>
      foldTestCoverage([
        shard('shard-1/coverage.bin', 'test/alpha.test.ts'),
        shard('shard-2/coverage.bin', 'test/alpha.test.ts'),
      ]),
    ).toThrow(/`test\/alpha\.test\.ts` was recorded by shard-1\/coverage\.bin and again by shard-2\/coverage\.bin/);
  });

  it('refuses a module two shards built from different source', () => {
    const alpha = shard('shard-1/coverage.bin', 'test/alpha.test.ts');
    const beta = shard('shard-2/coverage.bin', 'test/beta.test.ts');
    const rebuilt = {
      ...beta,
      coverage: {
        ...beta.coverage,
        modules: beta.coverage.modules.map((module) => ({ ...module, sourceDigest: 'source:other' })),
      },
    };

    expect(() => foldTestCoverage([alpha, rebuilt])).toThrow(
      /`src\/decide\.ts` is different source in shard-1\/coverage\.bin and shard-2\/coverage\.bin/,
    );
  });

  it('is the shard itself when there is one, and nothing when there are none', () => {
    const alpha = shard('shard-1/coverage.bin', 'test/alpha.test.ts');

    expect(foldTestCoverage([alpha])).toBe(alpha.coverage);
    expect(() => foldTestCoverage([])).toThrow(/at least one/);
  });
});

describe('existingCoverage', () => {
  it('treats a file it cannot decode as one that is not there', async () => {
    // The read half of a read-modify-write. Refusing here would stop every
    // later run from recording anything until somebody deleted the file by
    // hand; replacing it costs this machine evidence the next full run
    // restores, and which meanwhile widens selection rather than narrowing it.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-merge-'));
    try {
      const file = resolve(root, 'coverage.bin');
      await writeFile(file, 'half a copy of something else', 'utf8');

      expect(await existingCoverage(file)).toBeUndefined();
      expect(await existingCoverage(resolve(root, 'absent.bin'))).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
