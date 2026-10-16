import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** The file's own cut, as its text on disk gives it: the source's. */
const cut = (file: string) => (file === 'src/cart.ts' ? source : undefined);

describe('one file read twice', () => {
  it('is held under the file\'s own cut, whichever readings of it the run loaded', () => {
    for (const loaded of [[build], [build, source], [source, build]]) {
      const joined = joinReadings(new Map(loaded.map((each) => [each.id, each])), cut);

      expect([...joined.modules.keys()]).toEqual(['src/cart.ts']);
      expect(joined.modules.get('src/cart.ts')).toBe(source);
    }
  });

  it('reads each reading\'s ordinals in that cut, and gives a region with no place in the file no ordinal', () => {
    const { readings } = joinReadings(new Map([['dist/cart.js', build], ['src/cart.ts', source]]), cut);

    expect(readings.get('dist/cart.js')).toEqual({ id: 'src/cart.ts', lands: [0, undefined, 1, 2] });
    expect(readings.get('src/cart.ts')).toEqual({ id: 'src/cart.ts', lands: [0, 1, 2] });
  });

  it('is one journal row for a file that loaded both readings', () => {
    const { readings } = joinReadings(new Map([['dist/cart.js', build], ['src/cart.ts', source]]), cut);
    const journal = {
      testFile: 'test/cart.test.ts',
      modules: [
        { id: 'dist/cart.js', hits: [0, 1, 3], shared: [0], loaded: [0] },
        { id: 'src/cart.ts', hits: [0, 1], shared: [0], loaded: [] },
      ],
    };

    expect(joinedJournals([journal], readings)).toEqual([{
      testFile: 'test/cart.test.ts',
      modules: [{ id: 'src/cart.ts', hits: [0, 1, 2], shared: [0], loaded: [0] }],
    }]);
  });

  it('is uninstrumented when either reading was, since what that one ran is unknown', () => {
    const joined = joinReadings(new Map([['dist/cart.js', reading('dist/cart.js', [], false)], ['src/cart.ts', source]]), cut);

    expect(joined.modules.get('src/cart.ts')).toMatchObject({ instrumented: false, blocks: [] });
    expect(joined.readings.get('dist/cart.js')).toEqual({ id: 'src/cart.ts', lands: [] });
    expect(joined.readings.get('src/cart.ts')).toEqual({ id: 'src/cart.ts', lands: [] });
  });

  it('is uninstrumented when the file is not there to cut', () => {
    const joined = joinReadings(new Map([['dist/cart.js', build]]), () => undefined);

    expect(joined.modules.get('dist/cart.js')).toMatchObject({ file: 'src/cart.ts', instrumented: false, blocks: [] });
    expect(joined.readings.get('dist/cart.js')).toEqual({ id: 'dist/cart.js', lands: [] });
  });

  it('is uninstrumented when the file on disk is not the text a reading was cut from', () => {
    const edited = { ...source, sourceDigest: 'v1:edited' };
    const joined = joinReadings(new Map([['dist/cart.js', build]]), () => edited);

    expect(joined.modules.get('src/cart.ts')).toMatchObject({ sourceDigest: 'v1:edited', instrumented: false, blocks: [] });
  });

  it('is its reading when the run read it once, as itself', () => {
    const joined = joinReadings(new Map([['src/cart.ts', source]]), () => undefined);

    expect(joined.modules.get('src/cart.ts')).toBe(source);
    expect(joined.readings.size).toBe(0);
  });

  it('lands a build\'s module that spans more than the file on the file\'s module, so the record is one a reader opens', () => {
    const wider = reading('dist/cart.js', [
      block(0, 'module', [1, 8]),
      block(1, 'helper'),
      block(2, 'entry', [1, 6], 0),
      block(3, '__name.arg0', [5, 5], 2),
    ]);
    const joined = joinReadings(new Map([['dist/cart.js', wider]]), cut);
    const { file, sourceDigest, instrumented, blocks } = joined.modules.get('src/cart.ts')!;
    const record = { version: 3, instrumentation: 'v1', tests: [], modules: [{ file, sourceDigest, instrumented, blocks }] } as const;

    expect(joined.readings.get('dist/cart.js')).toEqual({ id: 'src/cart.ts', lands: [0, undefined, 1, 2] });
    expect(decodeTestCoverage(encodeTestCoverage(record)).modules[0]!.blocks).toHaveLength(3);
  });
});

describe('without the addon', () => {
  // Cut at the addon: what is under test is the refusal, and the loader's own reasons are `native.test.ts`'s.
  afterEach(() => {
    vi.doUnmock('../addon.js');
    vi.resetModules();
  });

  const absent = async () => {
    vi.resetModules();
    vi.doMock('../addon.js', () => ({ native: () => undefined, nativeRefusal: () => '@variance-authority/sense-linux-x64-gnu is not installed' }));
    return import('./readings.js');
  };

  it('refuses to join one file read twice, naming why the addon did not load', async () => {
    const { joinReadings: join } = await absent();

    expect(() => join(new Map([['dist/cart.js', build], ['src/cart.ts', source]]), cut))
      .toThrow("joining one file's readings requires the Sense native addon: @variance-authority/sense-linux-x64-gnu is not installed");
  });

  it('joins a file read once without it', async () => {
    const { joinReadings: join } = await absent();

    expect([...join(new Map([['src/cart.ts', source]]), cut).modules.keys()]).toEqual(['src/cart.ts']);
  });
});
