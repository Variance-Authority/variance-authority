import { describe, expect, it } from 'vitest';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { blob, column, sections } from './format-layout.js';

const tests = [
  { id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' },
  { id: 'a.test.ts > two', file: 'a.test.ts', name: 'two' },
];
const shape = { kind: 'function', name: 'total', path: 'total', source: true };

describe('the journey set spelling', () => {
  it('reads a flag for load time and credits only the cases that called in', () => {
    const sets = new CrossingSets(tests.length);
    const bytes = encodeSetExecutionIndex({
      tests,
      modules: [{
        file: 'src/m.ts',
        blocks: [{ ...shape, startLine: 1, endLine: 3 }, { ...shape, startLine: 5, endLine: 7 }],
        called: Uint32Array.of(sets.intern([0]), sets.intern([1])),
        loaded: Uint8Array.of(1, 0),
      }],
      sets: sets.pool(),
    });

    expect(decodeExecutionIndex(bytes).modules[0]?.blocks).toEqual([
      { ...shape, startLine: 1, endLine: 3, loaded: true, crossings: [{ test: 0, distance: 0 }] },
      { ...shape, startLine: 5, endLine: 7, crossings: [{ test: 1, distance: 0 }] },
    ]);
  });

  it('reads an artifact that recorded who loaded a region as the flag its set implies', () => {
    // Version 2 held a set of loaders per region. `two` loaded the first region
    // and never called it: it is no longer credited there, and the region is
    // flagged instead.
    const sets = new CrossingSets(tests.length);
    const called = Uint32Array.of(sets.intern([0]), sets.intern([1]));
    const loadedSet = Uint32Array.of(sets.intern([1]), sets.intern([]));
    const pool = sets.pool();
    const strings = ['a.test.ts > one', 'a.test.ts', 'one', 'a.test.ts > two', 'two', 'src/m.ts', 'function', 'total'];
    const encoded = strings.map((value) => Buffer.from(value, 'utf8'));
    const offsets = new Uint32Array(strings.length + 1);
    encoded.forEach((value, at) => { offsets[at + 1] = offsets[at]! + value.length; });
    const bytes = sections({
      'strings.blob': blob(Buffer.concat(encoded), offsets),
      'strings.off': column(offsets),
      'tests.id': column(Uint32Array.of(0, 3)),
      'tests.file': column(Uint32Array.of(1, 1)),
      'tests.name': column(Uint32Array.of(2, 4)),
      'modules.file': column(Uint32Array.of(5)),
      'modules.blocks': column(Uint32Array.of(0, 2)),
      'blocks.kind': column(Uint32Array.of(6, 6)),
      'blocks.name': column(Uint32Array.of(7, 7)),
      'blocks.path': column(Uint32Array.of(7, 7)),
      'blocks.start': column(Uint32Array.of(1, 5)),
      'blocks.end': column(Uint32Array.of(3, 7)),
      'blocks.source': column(Uint8Array.of(1, 1)),
      'blocks.calledSet': column(called),
      'blocks.loadedSet': column(loadedSet),
      'sets.blob': blob(pool.bytes, pool.offsets),
      'sets.off': column(pool.offsets),
    }, 2);

    const index = decodeExecutionIndex(bytes);
    expect(index.tests).toEqual(tests);
    expect(index.modules[0]?.blocks).toEqual([
      { ...shape, startLine: 1, endLine: 3, loaded: true, crossings: [{ test: 0, distance: 0 }] },
      { ...shape, startLine: 5, endLine: 7, crossings: [{ test: 1, distance: 0 }] },
    ]);
  });

  it('refuses a version it did not write', () => {
    const bytes = sections({ 'tests.id': column(Uint32Array.of(0)) }, 9);

    expect(() => decodeExecutionIndex(bytes)).toThrow('unsupported execution index version: 9');
  });
});
