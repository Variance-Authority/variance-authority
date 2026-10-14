import { describe, expect, it } from 'vitest';
import { native } from '../addon.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { joinedJournals, joinReadings } from './readings.js';
import type { CapturedModule } from './instrumented-modules.js';
import type { CoverageBlock } from './index.js';

const block = (ordinal: number, path: string, lines?: [number, number], owner?: number): CoverageBlock => ({
  ordinal,
  kind: ordinal === 0 ? 'module' : 'function',
  ...(owner === undefined ? {} : { owner }),
  digest: `v1:${path}`,
  name: path === 'module' ? '' : 'total',
  path,
  ...(lines === undefined ? {} : { startLine: lines[0], endLine: lines[1] }),
  source: true,
  testFiles: [],
});

const reading = (id: string, blocks: readonly CoverageBlock[], instrumented = true): CapturedModule => ({
  file: 'src/cart.ts',
  id,
  sourceDigest: 'v1:cart',
  instrumented,
  blocks: instrumented ? blocks : [],
});

/** The source: a module, a function, and a callback inside it. */
const source = reading('src/cart.ts', [
  block(0, 'module', [1, 7]),
  block(1, 'entry', [1, 6], 0),
  block(2, 'reduce.arg0', [5, 5], 1),
]);

/** The build: a helper with no origin first, then the function, whose callback it names differently. */
const build = reading('dist/cart.js', [
  block(0, 'module', [1, 7]),
  block(1, 'helper'),
  block(2, 'entry', [1, 6], 0),
  block(3, '__name.arg0', [5, 5], 2),
]);

describe('one file read twice', () => {
  it('is held under the reading that is the file, at the regions both readings cut', () => {
    const joined = joinReadings(new Map([['dist/cart.js', build], ['src/cart.ts', source]]));

    expect([...joined.modules.keys()]).toEqual(['src/cart.ts']);
    expect(joined.modules.get('src/cart.ts')!.blocks.map(({ ordinal, path, owner }) => [ordinal, path, owner]))
      .toEqual([[0, 'module', undefined], [1, 'entry', 0]]);
  });

  it('reads each reading\'s ordinals in that table, and gives a region with no place in the file no ordinal', () => {
    const { readings } = joinReadings(new Map([['dist/cart.js', build], ['src/cart.ts', source]]));

    expect(readings.get('dist/cart.js')).toEqual({ id: 'src/cart.ts', lands: [0, undefined, 1, 1] });
    expect(readings.get('src/cart.ts')).toEqual({ id: 'src/cart.ts', lands: [0, 1, 1] });
  });

  it('is one journal row for a file that loaded both readings', () => {
    const { readings } = joinReadings(new Map([['dist/cart.js', build], ['src/cart.ts', source]]));
    const journal = {
      testFile: 'test/cart.test.ts',
      modules: [
        { id: 'dist/cart.js', hits: [0, 1, 3], shared: [0], loaded: [0] },
        { id: 'src/cart.ts', hits: [0, 1], shared: [0], loaded: [] },
      ],
    };

    expect(joinedJournals([journal], readings)).toEqual([{
      testFile: 'test/cart.test.ts',
      modules: [{ id: 'src/cart.ts', hits: [0, 1], shared: [0], loaded: [0] }],
    }]);
  });

  it('is uninstrumented when either reading was, since what that one ran is unknown', () => {
    const joined = joinReadings(new Map([['dist/cart.js', reading('dist/cart.js', [], false)], ['src/cart.ts', source]]));

    expect(joined.modules.get('src/cart.ts')).toMatchObject({ instrumented: false, blocks: [] });
    expect(joined.readings.get('src/cart.ts')).toEqual({ id: 'src/cart.ts', lands: [] });
  });

  it('is its reading when the run read it once, under the id its probes report', () => {
    const joined = joinReadings(new Map([['dist/cart.js', build]]));

    expect(joined.modules.get('dist/cart.js')).toBe(build);
    expect(joined.readings.size).toBe(0);
  });

  it('opens on a module that owns every region whose owner no reading shares, so the record is one a reader opens', () => {
    const wider = reading('dist/cart.js', [
      block(0, 'module', [1, 8]),
      block(1, 'helper'),
      block(2, 'entry', [1, 6], 0),
      block(3, '__name.arg0', [5, 5], 2),
    ]);
    const joined = joinReadings(new Map([['dist/cart.js', wider], ['src/cart.ts', source]]));
    const { file, sourceDigest, instrumented, blocks } = joined.modules.get('src/cart.ts')!;
    const record = { version: 3, instrumentation: 'v1', tests: [], modules: [{ file, sourceDigest, instrumented, blocks }] } as const;

    expect(blocks.map(({ ordinal, kind, owner, startLine, endLine }) => [ordinal, kind, owner, startLine, endLine]))
      .toEqual([[0, 'module', undefined, 1, 8], [1, 'function', 0, 1, 6]]);
    expect(joined.readings.get('dist/cart.js')).toEqual({ id: 'src/cart.ts', lands: [0, undefined, 1, 1] });
    expect(joined.readings.get('src/cart.ts')).toEqual({ id: 'src/cart.ts', lands: [0, 1, 1] });
    expect(decodeTestCoverage(encodeTestCoverage(record)).modules[0]!.blocks).toHaveLength(2);
  });
});

describe('one file\'s inventories, read at the regions they share', () => {
  type Region = { kind: string; name: string; path: string; startLine: number; endLine: number; source: boolean };
  const module = { kind: 'module', name: '', path: '', startLine: 1, endLine: 20, source: true };
  const outer = { kind: 'function', name: 'outer', path: 'outer', startLine: 2, endLine: 10, source: true };
  const inner = { kind: 'function', name: 'inner', path: 'inner', startLine: 12, endLine: 15, source: true };
  const branch = { kind: 'branch', name: '', path: 'outer', startLine: 4, endLine: 6, source: true };

  /** The shared regions as the base inventory holds them, then the whole file where one was cut. */
  const reconciled = (inventories: Region[][]) => {
    const { base, kept, whole, lands } = native()!.reconcileRegions!(inventories);
    return { blocks: [...kept.map((at) => inventories[base]![at]!), ...whole == null ? [] : [{ ...whole }]], lands };
  };

  it('keeps one inventory as it is', () => {
    expect(reconciled([[module, outer]])).toEqual({ blocks: [module, outer], lands: [[0, 1]] });
  });

  it('reads a file two builds cut apart at the regions both hold, whatever order they come in', () => {
    const plain = [module, outer, inner];
    const split = [module, outer, branch, inner];
    expect(reconciled([plain, split])).toEqual({ blocks: [module, outer, inner], lands: [[0, 1, 2], [0, 1, 1, 2]] });
    expect(reconciled([split, plain])).toEqual({ blocks: [module, outer, inner], lands: [[0, 1, 1, 2], [0, 1, 2]] });
  });

  it('hands back the base inventory\'s own regions, so a caller finds what they carry beyond a shape', () => {
    const plain = [module, outer, inner];
    const { blocks } = reconciled([[module, outer, branch, inner], plain]);
    expect(blocks[1]).toBe(plain[1]);
  });

  it('reads a region no shared region encloses at one region spanning the file', () => {
    const short = [{ ...module, endLine: 20 }, outer];
    const long = [{ ...module, endLine: 22 }, outer];
    expect(reconciled([short, long])).toEqual({ blocks: [outer, { ...module, endLine: 22 }], lands: [[1, 0], [1, 0]] });
  });

  it('reads two cuts that agree as the one cut they are', () => {
    expect(reconciled([[module, outer], [module, outer]])).toEqual({ blocks: [module, outer], lands: [[0, 1], [0, 1]] });
  });

  it('keeps the same base whatever order two cuts that differ only by a name come in', () => {
    const first = [module, { ...outer, name: 'a' }];
    const second = [module, { ...outer, name: 'b' }];
    expect(reconciled([first, second])).toEqual({ blocks: [module], lands: [[0, 0], [0, 0]] });
    expect(reconciled([second, first])).toEqual({ blocks: [module], lands: [[0, 0], [0, 0]] });
  });

  it('spans no source lines with a file whose only source regions run backwards', () => {
    const one = [{ ...module, startLine: 5, endLine: 3 }];
    const two = [{ ...module, startLine: 6, endLine: 3 }];
    expect(reconciled([one, two]).blocks).toEqual([{ ...module, startLine: 5, endLine: 3, source: false }]);
  });
});
