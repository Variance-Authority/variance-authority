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
  report: 'out/report.json',
} as const;

/** The value under test, with one field replaced. */
function withField(field: string, value: unknown): unknown {
  return { ...VALID, [field]: value };
}

function attempt(value: unknown): ConfigError {
  try {
    parseConfig(value, OPTIONS);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected parseConfig to refuse this value');
}

describe('where baselines live', () => {
  it('accepts a baseline path template that keeps images beside the file that declares them', () => {
    // The template decides where a baseline file lands and what it is called,
    // and the config is the only place that decision can be made once for every
    // command that reads the root.
    const path = '{dir}/__baselines__/{file}/{name}-{engine}';
    for (const kind of ['directory', 'lfs'] as const) {
      const config = parseConfig(withField('baselines', { kind, root: '.', path }), OPTIONS);

      expect(config.baselines).toEqual({ kind, root: '/repo', path });
    }
  });

  it('refuses a path template it cannot render, by the field', () => {
    // A template that could put two subjects on one path, or a path outside the
    // root, is refused before a run writes anything under it.
    const error = attempt(withField('baselines', { kind: 'directory', root: 'b', path: '{title}/{engine}' }));

    expect(error.field).toBe('baselines.path');
    expect(error.message).toContain('neither {name} nor {id}');
  });

  it('refuses a cache carrying baselines that sit beside the code, by the field', () => {
    // With `{dir}` the root is the repository, and the cache carries the root.
    const error = attempt(withField('baselines', {
      kind: 'directory',
      root: '.',
      path: '{dir}/__baselines__/{file}/{name}-{engine}',
      carry: 'actions-cache',
    }));

    expect(error.field).toBe('baselines.carry');
    expect(error.message).toContain('{dir}');
  });

  it('refuses the `layout` it replaced, and names `path`', () => {
    const error = attempt(withField('baselines', { kind: 'directory', root: 'b', layout: 'beside' }));

    expect(error.field).toBe('baselines.layout');
    expect(error.message).toContain('path');
  });

  it('resolves a records directory against the config file, like the root beside it', () => {
    // The two are read together by a person deciding what their repository
    // tracks. A pair of paths that resolved against different things is a pair
    // somebody gets wrong once and finds out about a week later.
    const config = parseConfig(
      withField('baselines', { kind: 'directory', root: 'b', records: '.variance/records' }),
      OPTIONS,
    );

    expect(config.baselines).toEqual({
      kind: 'directory',
      root: '/repo/b',
      records: '/repo/.variance/records',
    });
  });

  it('refuses a records directory that is not a path', () => {
    // `records: true` is how an operator asks for the split without saying
    // where, and there is no answer to guess: the point of the key is that the
    // records go somewhere version control is not looking.
    const error = attempt(withField('baselines', { kind: 'directory', root: 'b', records: true }));

    expect(error.field).toBe('baselines.records');
  });
});
