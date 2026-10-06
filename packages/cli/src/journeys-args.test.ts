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
    expect(() => parseArgs(['journeys', '--suite', 'unit', '--collected', 'collected-unit.txt'])).toThrow('`--collected` says which test files a fold keeps, and nothing was named to fold');
  });
});

describe('journeys finalize and stitch', () => {
  it('refuses finalize with a flag or other than one journey file', () => {
    const refusal = '`variance journeys finalize` takes one journey file and no flags';
    expect(() => parseArgs(['journeys', 'finalize', 'journeys.bin', '--all'])).toThrow(refusal);
    expect(() => parseArgs(['journeys', 'finalize'])).toThrow(refusal);
    expect(() => parseArgs(['journeys', 'finalize', 'one.bin', 'two.bin'])).toThrow(refusal);
  });

  it('refuses stitch without a shard, without `--into`, or with another flag', () => {
    const refusal = '`variance journeys stitch` takes one or more shard files and `--into <journey-file>`';
    expect(() => parseArgs(['journeys', 'stitch', '--into', 'all.bin'])).toThrow(refusal);
    expect(() => parseArgs(['journeys', 'stitch', 'one.bin'])).toThrow(refusal);
    expect(() => parseArgs(['journeys', 'stitch', 'one.bin', '--into', 'all.bin', '--all'])).toThrow(refusal);
  });
});
