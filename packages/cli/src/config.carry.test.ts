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

const SHARE = { kind: 'directory', root: 'shared' } as const;

function attempt(value: unknown): ConfigError {
  try {
    parseConfig(value, OPTIONS);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('who carries an artifact', () => {
  it('is nobody unless the config says, so a config that does not change keeps today’s behaviour', () => {
    const config = parseConfig({ ...VALID, report: 'out/report.json' }, OPTIONS);

    expect(config.report).toBe('/repo/out/report.json');
    expect(config.reportCarry).toBeUndefined();
    expect(config.baselines).toEqual({ kind: 'directory', root: '/repo/baselines' });
  });

  it('reads the report’s object form, with its images still beside it', () => {
    const config = parseConfig({ ...VALID, share: SHARE, report: { path: 'out/report.json', carry: 'share' } }, OPTIONS);

    expect(config.report).toBe('/repo/out/report.json');
    expect(config.reportCarry).toBe('share');
    expect(config.images).toBe('/repo/out/images');
  });

  it('carries a baseline directory job to job through the host', () => {
    const config = parseConfig({ ...VALID, baselines: { ...VALID.baselines, carry: 'actions-cache' } }, OPTIONS);

    expect(config.baselines).toEqual({ kind: 'directory', root: '/repo/baselines', carry: 'actions-cache' });
  });

  it('refuses a share for baselines, and says why', () => {
    const error = attempt({ ...VALID, share: SHARE, baselines: { ...VALID.baselines, carry: 'share' } });

    expect(error.field).toBe('baselines.carry');
    expect(error.message).toContain('a share keeps the latest record per mainline');
  });

  it('refuses a carrier outside the closed list, naming the field', () => {
    const error = attempt({ ...VALID, report: { path: 'out/report.json', carry: 'artifact' } });

    expect(error.field).toBe('report.carry');
    expect(error.message).toContain('must be one of actions-cache, share');
  });

  it('refuses a report object with no path', () => {
    expect(attempt({ ...VALID, report: { carry: 'actions-cache' } }).field).toBe('report.path');
  });

  it.each([
    [{ report: { path: 'out/report.json', carry: 'share' } }, 'report.carry'],
    [{ suites: { stories: { kind: 'visual', carry: 'share' } } }, 'suites.stories.carry'],
  ])('refuses `share` in a file with no `share` section to carry it: %j', (extra, field) => {
    const error = attempt({ ...VALID, ...extra });

    expect(error.field).toBe(field);
    expect(error.message).toContain('has no `share` section to carry it');
  });
});
