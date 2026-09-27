import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './bin.js';
import { ConfigError, parseConfig } from './config.js';

/**
 * The three places a sharded build is spelled: `--shard` on a run, `workers` in
 * the config, and the shards' reports named to `share --publish`.
 */

const VALID = {
  project: 'todomvc',
  profile: 'chromium',
  viewport: { width: 1280, height: 800 },
  retention: 'durable',
  subjects: { kind: 'list', ids: ['fixture:button'], collector: './collector.mjs' },
  baselines: { kind: 'directory', root: 'baselines' },
  fonts: ['Inter/400/normal/sha256-abc'],
  report: 'out/report.json',
} as const;
const OPTIONS = { source: 'variance.config.json', baseDir: '/repo' } as const;

describe('--shard', () => {
  it('reads k/n onto the run', () => {
    expect(parseArgs(['run', '--shard', '2/3'])).toMatchObject({ command: 'run', shard: { index: 2, total: 3 } });
  });

  it('refuses a shard that is not one', () => {
    expect(() => parseArgs(['run', '--shard', '4/3'])).toThrow(/names no shard/);
    expect(() => parseArgs(['run', '--shard', 'last'])).toThrow(/takes `k\/n`/);
  });
});

describe('workers', () => {
  it('is a whole number of worlds, absent when unset', () => {
    expect(parseConfig({ ...VALID, workers: 3 }, OPTIONS).workers).toBe(3);
    expect('workers' in parseConfig(VALID, OPTIONS)).toBe(false);
    expect(() => parseConfig({ ...VALID, workers: 1.5 }, OPTIONS)).toThrow(ConfigError);
  });
});

describe('share --publish with several reports', () => {
  it('takes every shard of one build', () => {
    expect(parseArgs(['share', '--publish', 'a.json', 'b.json'])).toMatchObject({
      command: 'share',
      publish: true,
      reports: ['a.json', 'b.json'],
    });
  });

  it('refuses reports on a lookup', () => {
    expect(() => parseArgs(['share', 'a.json'])).toThrow(/is for `--publish`/);
  });

  it('resolves the config beside them as usual', () => {
    expect(parseArgs(['share', '--publish'])).toMatchObject({ config: resolve('variance.config.json'), reports: [] });
  });
});
