import { describe, expect, it } from 'vitest';

import { decodeCase, decodeReadings, encodeReadings } from './readings-bytes.js';

describe('encodeReadings', () => {
  // The same bytes `record_parts_tests.rs` expects the native fold to write.
  it('writes each path after what it shares with the one before, and a digest as its bytes', () => {
    const inputs = [['src/a.test.ts', 'v1:00ff'], ['src/b.test.ts', 'sha:x']] as const;
    const bytes = encodeReadings([], inputs);

    expect([...bytes]).toEqual([0, 2, 0, 13, ...Buffer.from('src/a.test.ts'), 2, 0x00, 0xff, 4, 9, ...Buffer.from('b.test.ts'), 0, 5, ...Buffer.from('sha:x')]);
    expect([...decodeReadings(bytes).inputs]).toEqual(inputs);
  });

  it('reads back ids that share a prefix, one that holds another and one past ASCII', () => {
    const ids = ['a > b', 'a > b > c', 'a > bé', 'z'];
    const read = decodeReadings(encodeReadings(ids.map((id) => [id, [{ count: 1 }]]), []));

    expect([...read.cases.keys()]).toEqual(ids);
  });

  it('refuses a case that claims more regions than it has bytes for, before making room for them', () => {
    // No strings, one reading of count 1 holding regions, and a count of 2^35 - 1, the most five bytes hold.
    const claims = Uint8Array.from([0, 1, 1, 4, 0xff, 0xff, 0xff, 0xff, 0x7f]);

    expect(() => decodeCase(claims)).toThrow('not one this build reads');
  });
});
