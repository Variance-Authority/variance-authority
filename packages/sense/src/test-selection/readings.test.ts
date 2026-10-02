import { describe, expect, it } from 'vitest';
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
