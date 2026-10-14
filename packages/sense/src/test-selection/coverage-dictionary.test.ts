import { expect, it, vi } from 'vitest';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import * as views from './format-view.js';

it('reads the stored dictionary once when decoding the whole coverage model', () => {
  const input = {
    version: 3 as const, instrumentation: 'fixture',
    tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
    modules: [{ file: 'a.ts', sourceDigest: 'a', instrumented: true,
      blocks: [{ ordinal: 0, kind: 'module' as const, digest: 'root', name: '', path: '',
        source: true, testFiles: ['a.test.ts'], loadedBy: ['a.test.ts'] }] }],
  };
  const bytes = encodeTestCoverage(input);
  const view = views.openTestCoverage(bytes);
  const dictionary = vi.fn(() => view.dictionary());
  const opened = vi.spyOn(views, 'openTestCoverage').mockReturnValue(new Proxy(view, {
    get(target, key) {
      if (key === 'dictionary') return dictionary;
      if (key === 'string') return () => { throw new Error('random string decompression'); };
      return Reflect.get(target, key);
    },
  }));
  try {
    expect(decodeTestCoverage(bytes)).toEqual(input);
    expect(dictionary).toHaveBeenCalledTimes(1);
  } finally { opened.mockRestore(); }
});


it('shares one decoded list for regions that name the same stored crossing set', () => {
  const input = { version: 3 as const, instrumentation: 'fixture',
    tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
    modules: [{ file: 'a.ts', sourceDigest: 'a', instrumented: true,
      blocks: [{ ordinal: 0, kind: 'module' as const, digest: 'root', name: '', path: '', source: true,
        testFiles: ['a.test.ts'], loadedBy: ['a.test.ts'] }] }] };
  const decoded = decodeTestCoverage(encodeTestCoverage(input));
  expect(decoded).toEqual(input);
  expect(decoded.modules[0]!.blocks[0]!.testFiles).toBe(decoded.modules[0]!.blocks[0]!.loadedBy);
});
