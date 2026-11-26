import { describe, expect, it } from 'vitest';
import { saidLaid } from './case-said.js';
import { saidRead } from './case-said-read.js';

const EMPTY = { bytes: new Uint8Array(0), offsets: new Uint32Array([0]) };

describe('what each case heard, off the sections the addon laid', () => {
  const heard = [
    JSON.stringify({ said: [['flag:ff', 'true', 'a.test.ts:3', 1], ['flag:gone', null, 'a.test.ts:4', 2]], misused: [['nöt a key', null, 'a.test.ts:5', 0]] }),
    undefined,
    JSON.stringify({ said: [['flag:ff', 'true', 'a.test.ts:3', 1]], read: [['flag:ff', '"x"', 'src/a.ts:9', 0]] }),
    JSON.stringify({ said: [], read: [] }),
  ];

  it('reads back what each case said, read and misused, and nothing for one nobody listened to', () => {
    const { said, read, misused, ...pool } = saidLaid(heard, EMPTY, heard.length);

    expect(saidRead({ said: said!, read: read!, misused: misused! }, pool, heard.length)).toEqual(heard);
  });

  it('reads a record that holds no section as no case listened to', () => {
    expect(saidRead({}, EMPTY, 2)).toEqual([undefined, undefined]);
  });

  it.each([
    ['cut short', (bytes: Uint8Array) => bytes.slice(0, -4)],
    ['with a word past its end', (bytes: Uint8Array) => new Uint8Array([...bytes, 0, 0, 0, 0])],
    ['naming a set the pool does not hold', (bytes: Uint8Array) => new Uint8Array([255, 255, 0, 0, ...bytes.slice(4)])],
    ['of no bytes', () => new Uint8Array(0)],
  ])('refuses a section %s', (_, damaged) => {
    const { said, ...pool } = saidLaid(heard, EMPTY, heard.length);

    expect(() => saidRead({ said: damaged(said!) }, pool, heard.length)).toThrow('not a variance-authority execution index');
  });
});
