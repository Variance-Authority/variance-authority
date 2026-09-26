import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from './config.js';

const OPTIONS = { source: 'variance.config.json', baseDir: '/repo' } as const;

const VALID = {
  project: 'todomvc',
  profile: 'chromium',
  viewport: { width: 1280, height: 800 },
  retention: 'durable',
  subjects: { kind: 'list', ids: ['fixture:button'], collector: './collector.mjs' },
  baselines: { kind: 'directory', root: 'baselines' },
  fonts: ['Inter/400/normal/sha256-abc'],
} as const;

function attempt(share: unknown): ConfigError {
  try {
    parseConfig({ ...VALID, share }, OPTIONS);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('the share section', () => {
  it('names its mainlines and remote on every kind, and leaves them unset for git to answer', () => {
    expect(parseConfig({ ...VALID, share: { kind: 'directory', root: 'shared' } }, OPTIONS).share)
      .toEqual({ kind: 'directory', root: '/repo/shared' });
    expect(parseConfig({ ...VALID, share: { kind: 'git', mainlines: ['main', 'release/2.0'], remote: 'upstream' } }, OPTIONS).share)
      .toEqual({ kind: 'git', mainlines: ['main', 'release/2.0'], remote: 'upstream' });
    expect(parseConfig({ ...VALID, share: { kind: 'git', namespace: 'refs/ci/variance' } }, OPTIONS).share)
      .toEqual({ kind: 'git', namespace: 'refs/ci/variance' });
  });

  it('refuses an empty mainline list, a namespace outside refs/, and the keys it replaced', () => {
    expect(attempt({ kind: 'git', mainlines: [] })).toMatchObject({ field: 'share.mainlines' });
    expect(attempt({ kind: 'git', namespace: 'variance' })).toMatchObject({ field: 'share.namespace' });
    expect(attempt({ kind: 'directory', root: 'shared', mainline: 'origin/main' }).message).toContain('mainline');
    expect(attempt({ kind: 'directory', root: 'shared', depth: 50 }).message).toContain('depth');
  });
});
