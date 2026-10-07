import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';
import { helpFor } from './usage.js';

describe('what collect is asked for', () => {
  it('collects one shard with its own workers into one part', () => {
    expect(parseArgs(['collect', '--shard', '2/4', '--workers', '2', '--subjects', 'button--*', '--out', 'evidence-2.json'])).toEqual({
      command: 'collect',
      config: resolve('variance.config.json'),
      shard: { index: 2, total: 4 },
      workers: 2,
      subjects: 'button--*',
      out: resolve('evidence-2.json'),
    });
  });

  it('refuses a collection with nowhere to write it', () => {
    expect(() => parseArgs(['collect'])).toThrow(/--out <part\.json>/);
  });

  it('refuses a worker count that is not a positive whole number', () => {
    expect(() => parseArgs(['collect', '--workers', '0', '--out', 'p.json'])).toThrow(/--workers .* positive whole number, not `0`/);
    expect(() => parseArgs(['collect', '--workers', 'two', '--out', 'p.json'])).toThrow(/not `two`/);
  });

  it('refuses a shard that names no shard', () => {
    expect(() => parseArgs(['collect', '--shard', '5/4', '--out', 'p.json'])).toThrow(/names no shard/);
  });

  it('merges the named parts into one suite index', () => {
    expect(parseArgs(['collect', 'merge', 'evidence-1.json', 'evidence-2.json', '--out', 'suite.index'])).toEqual({
      command: 'collect',
      operation: 'merge',
      parts: [resolve('evidence-1.json'), resolve('evidence-2.json')],
      out: resolve('suite.index'),
    });
  });

  it('refuses a merge with no parts, no --out, or a flag only collecting reads', () => {
    expect(() => parseArgs(['collect', 'merge', '--out', 'suite.index'])).toThrow(/at least one part/);
    expect(() => parseArgs(['collect', 'merge', 'a.json'])).toThrow(/--out <suite\.index>/);
    expect(() => parseArgs(['collect', 'merge', 'a.json', '--out', 's', '--shard', '1/2'])).toThrow(/merge` takes no `--shard`/);
    expect(() => parseArgs(['collect', 'merge', 'a.json', '--out', 's', '--config', 'v.json'])).toThrow(/takes no `--config`/);
  });

  it('refuses a positional that is not merge', () => {
    expect(() => parseArgs(['collect', 'evidence.json', '--out', 'p.json'])).toThrow(/collect merge/);
  });

  it('says in its help how many browsers a sharded collection opens', () => {
    expect(helpFor('collect')).toMatch(/4 shards × 2 workers is 8 browser worlds/);
  });
});
