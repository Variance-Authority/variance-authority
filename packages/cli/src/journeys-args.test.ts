import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './bin.js';

describe('journeys --collected', () => {
  it('names the runner\'s list beside the shards a landing keeps the record to', () => {
    expect(parseArgs(['journeys', 'shard.bin', '--suite', 'unit', '--collected', 'collected-unit.txt'])).toEqual({
      command: 'journeys',
      config: resolve('variance.config.json'),
      all: false,
      shards: [resolve('shard.bin')],
      suite: 'unit',
      collected: 'collected-unit.txt',
    });
  });

  it('refuses a list with nothing to fold', () => {
    expect(() => parseArgs(['journeys', '--suite', 'unit', '--collected', 'collected-unit.txt'])).toThrow('`--collected`');
  });
});
