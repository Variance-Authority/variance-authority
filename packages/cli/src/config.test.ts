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

describe('parseConfig', () => {
  it('accepts a minimal complete config and resolves paths against the config file', () => {
    // Relative paths that resolved against the *working directory* would point at
    // one thing locally and nothing in CI, where the job runs from the repo root.
    const config = parseConfig(VALID, OPTIONS);

    expect(config.report).toBe('/repo/out/report.json');
    expect(config.subjects.collector).toBe('/repo/collector.mjs');
    expect(config.baselines).toEqual({ kind: 'directory', root: '/repo/baselines' });
  });

  it('places images beside the report, not beside the config', () => {
    // `ObservationRecord.images` paths are relative to the report, so an image
    // directory anchored elsewhere produces links that resolve to nothing.
    expect(parseConfig(VALID, OPTIONS).images).toBe('/repo/out/images');
  });

  it('names the offending field in every refusal', () => {
    // The whole value of validating here rather than crashing later: the operator
    // is sent to one line instead of rereading the file.
    const error = attempt(withField('viewport', { width: '1280px', height: 800 }));

    expect(error).toBeInstanceOf(ConfigError);
    expect(error.field).toBe('viewport.width');
    expect(error.message).toContain('variance.config.json');
    expect(error.message).toContain('must be a positive integer');
  });

  it('refuses an unknown key by naming the key, not its parent', () => {
    // A silently ignored typo is the worst failure this file can have: the
    // operator reads their own config, sees the setting they meant, and the run
    // does something else.
    const error = attempt({ ...VALID, prfoile: 'chromium' });

    expect(error.field).toBe('prfoile');
    expect(error.message).toContain('project, profile');
  });

  it('refuses an unknown key inside a nested object under its full path', () => {
    const error = attempt(withField('baselines', { kind: 'directory', root: 'b', rot: 'x' }));
    expect(error.field).toBe('baselines.rot');
  });

  it('accepts a baseline layout that keeps images beside their subject', () => {
    // The layout decides where a baseline file lands, and the config is the only
    // place that decision can be made once for every command that reads the root.
    const config = parseConfig(withField('baselines', { kind: 'directory', root: 'b', layout: 'beside' }), OPTIONS);

    expect(config.baselines).toEqual({ kind: 'directory', root: '/repo/b', layout: 'beside' });
  });

  it('refuses a layout it does not implement rather than falling back to flat', () => {
    // A silently defaulted layout writes every baseline in the other place, and
    // the run that discovers it reports every subject as new.
    const error = attempt(withField('baselines', { kind: 'directory', root: 'b', layout: 'nested' }));

    expect(error.field).toBe('baselines.layout');
    expect(error.message).toContain('"flat" or "beside"');
  });

  it('refuses an unknown observation profile', () => {
    const error = attempt(withField('profile', 'webkit'));
    expect(error.field).toBe('profile');
    expect(error.message).toContain('known observation profile');
  });

  it('refuses durable retention with no baseline store', () => {
    // Durable retention compares against a stored image. Defaulting a root would
    // put baselines somewhere nobody chose and re-record them there forever.
    const { baselines, ...withoutStore } = VALID;
    void baselines;

    const error = attempt(withoutStore);
    expect(error.field).toBe('baselines');
    expect(error.message).toContain('required under "durable"');
  });

  it('refuses a baseline store under ephemeral retention rather than ignoring it', () => {
    // An operator who configured a root and saw the run succeed would believe
    // images are kept there. Ephemeral keeps nothing, and the belief never fails
    // loudly enough to be corrected.
    const error = attempt({ ...VALID, retention: 'ephemeral' });
    expect(error.field).toBe('baselines');
    expect(error.message).toContain('stores nothing');
  });

  it('refuses a font that is only a family name', () => {
    // A family name does not identify the bytes, and the identity digest is what
    // stops two machines with different cuts of Inter from comparing images.
    const error = attempt(withField('fonts', ['Inter']));
    expect(error.field).toBe('fonts[0]');
    expect(error.message).toContain('family/weight/style/hash');
  });

  it('accepts an absent fonts list as an explicit empty one', () => {
    const { fonts, ...withoutFonts } = VALID;
    void fonts;
    expect(parseConfig(withoutFonts, OPTIONS).fonts).toEqual([]);
  });

  it('refuses a history endpoint that is not an absolute http URL', () => {
    // A relative endpoint would be resolved against nothing at request time and
    // fail as a transport error mid-run, which reads as "history is down".
    const error = attempt({
      ...VALID,
      history: { endpoint: '/history', token: 't' },
    });
    expect(error.field).toBe('history.endpoint');
  });

  it('requires a history token, because a service refuses writes it cannot attribute', () => {
    const error = attempt({
      ...VALID,
      history: { endpoint: 'http://history.internal:7788' },
    });
    expect(error.field).toBe('history.token');
  });

  it('takes a history token from a named environment variable', () => {
    // The one setting that cannot be written down here. This file is in the
    // operator's repository; a bearer token in a repository has been shared with
    // everybody who can read it, and the alternative — generating the config in
    // CI — moves the whole run's configuration out of review to hide one string.
    process.env['VARIANCE_TEST_HISTORY_TOKEN'] = 'a-token-of-sixteen-plus';
    try {
      const config = parseConfig(
        {
          ...VALID,
          history: {
            endpoint: 'http://history.internal:7788',
            token: { env: 'VARIANCE_TEST_HISTORY_TOKEN' },
          },
        },
        OPTIONS,
      );
      expect(config.history?.token).toBe('a-token-of-sixteen-plus');
    } finally {
      delete process.env['VARIANCE_TEST_HISTORY_TOKEN'];
    }
  });

  it('names the variable, not the field, when the environment does not hold it', () => {
    // The config is correct and the secret is missing. Reporting this as
    // `history.token must be a non-empty string` sends the operator to the one
    // file that has nothing wrong with it.
    delete process.env['VARIANCE_TEST_HISTORY_ABSENT'];
    const error = attempt({
      ...VALID,
      history: {
        endpoint: 'http://history.internal:7788',
        token: { env: 'VARIANCE_TEST_HISTORY_ABSENT' },
      },
    });
    expect(error.field).toBe('history.token');
    expect(error.message).toContain('VARIANCE_TEST_HISTORY_ABSENT');
    expect(error.message).toContain('not set');
  });

  it('refuses a token object that names no variable', () => {
    const error = attempt({
      ...VALID,
      history: { endpoint: 'http://history.internal:7788', token: { name: 'TOKEN' } },
    });
    expect(error.field).toBe('history.token.env');
  });

  it('refuses an empty subject list', () => {
    const error = attempt(withField('subjects', { kind: 'list', ids: [], collector: 'c.mjs' }));
    expect(error.field).toBe('subjects.ids');
  });

  it('requires a collector module for both subject sources', () => {
    // Planning is generic; mounting a project's components is not. The config has
    // to name the module, because inferring one would guess at a build layout.
    const storybook = attempt(
      withField('subjects', { kind: 'storybook', index: 'sb/index.json' }),
    );
    expect(storybook.field).toBe('subjects.collector');
  });

  it('defaults deviceScaleFactor and colorScheme but not width or height', () => {
    // Scale and scheme have identity defaults; a size does not. A subject rendered
    // at 1280px because nobody said otherwise is a wrong observation.
    const config = parseConfig(VALID, OPTIONS);
    expect(config.viewport).toEqual({
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });

    expect(attempt(withField('viewport', { height: 800 })).field).toBe('viewport.width');
  });

  it('refuses a config that is not an object at all', () => {
    expect(attempt([]).field).toBe('the config');
  });
});


describe('ignore rules', () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    id: 'clock',
    reason: 'renders wall time',
    select: '.site-header time',
    ...over,
  });

  it('accepts a rule that names a place and a reason', () => {
    const config = parseConfig(withField('ignore', [rule()]), OPTIONS);

    expect(config.ignore).toEqual([
      { id: 'clock', reason: 'renders wall time', select: '.site-header time' },
    ]);
  });

  it('refuses a rule with no reason', () => {
    // The field that decides whether an ignore can ever be removed. A rule
    // nobody can evaluate later is a rule nobody dares delete.
    expect(attempt(withField('ignore', [rule({ reason: '' })])).field).toBe('ignore[0].reason');
  });

  it('refuses a rule that names neither a place nor a shape', () => {
    // A rule that is only a subject list is a tolerance with extra steps.
    const bare = { id: 'noisy', reason: 'flaky', subjects: ['story:*'] };

    expect(attempt(withField('ignore', [bare])).field).toBe('ignore[0]');
  });

  it('accepts a fingerprint with no selector', () => {
    const shaped = { id: 'avatar', reason: 'CDN crops', fingerprints: ['v1:abc'] };

    expect(parseConfig(withField('ignore', [shaped]), OPTIONS).ignore).toHaveLength(1);
  });

  it('refuses `bands`, which core has and no run reads', () => {
    // `IgnoreRule.bands` narrows an ignore over a pair of snapshots. The binary
    // compares against a stored image and never builds that pair, so accepting
    // the key here would sell a setting that parses and does nothing.
    expect(attempt(withField('ignore', [rule({ bands: ['token'] })])).field).toBe(
      'ignore[0].bands',
    );
  });

  it('refuses two rules with the same id', () => {
    // One id, two decisions, one line in the register. Deleting the flake that
    // one of them names would silently leave the other absorbing.
    expect(attempt(withField('ignore', [rule(), rule({ select: '.other' })])).field).toBe('ignore');
  });

  it('refuses an unknown key rather than ignoring it', () => {
    expect(attempt(withField('ignore', [rule({ selector: '.typo' })])).field).toBe(
      'ignore[0].selector',
    );
  });

  it('refuses an expiry that is not a date', () => {
    expect(attempt(withField('ignore', [rule({ until: 'next tuesday' })])).field).toBe('ignore[0]');
  });
});

describe('blank rules', () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    id: 'illustrations',
    reason: 'marketing re-exports these weekly and none of it is a regression',
    minPixels: 40_000,
    ...over,
  });

  it('accepts a rule that names a size and a reason', () => {
    expect(parseConfig(withField('blank', [rule()]), OPTIONS).blank).toEqual([rule()]);
  });

  it('accepts a rule that names only a path', () => {
    const byPath = { id: 'cdn', reason: 'third party', url: 'https://cdn.example/**' };
    expect(parseConfig(withField('blank', [byPath]), OPTIONS).blank).toEqual([byPath]);
  });

  it('refuses a rule with no reason', () => {
    expect(attempt(withField('blank', [rule({ reason: '' })])).field).toBe('blank[0].reason');
  });

  it('refuses a rule that names nothing, rather than blanking the whole page', () => {
    // Blanking every image on the site is a legitimate thing to want and an
    // illegitimate thing to arrive at by leaving a field out.
    expect(attempt(withField('blank', [{ id: 'all', reason: 'why not' }])).field).toBe('blank[0]');
  });

  it('refuses a band no image can satisfy', () => {
    expect(attempt(withField('blank', [rule({ minPixels: 100, maxPixels: 10 })])).field).toBe(
      'blank[0]',
    );
  });

  it('refuses a size that is not a count of pixels', () => {
    expect(attempt(withField('blank', [rule({ minPixels: '40000' })])).field).toBe(
      'blank[0].minPixels',
    );
    expect(attempt(withField('blank', [rule({ minPixels: -1 })])).field).toBe('blank[0].minPixels');
  });

  it('refuses two rules with the same id', () => {
    expect(attempt(withField('blank', [rule(), rule({ url: '**/other/**' })])).field).toBe('blank');
  });

  it('refuses an unknown key rather than ignoring it', () => {
    expect(attempt(withField('blank', [rule({ select: '.hero' })])).field).toBe('blank[0].select');
  });
});

function attempt(value: unknown): ConfigError {
  try {
    parseConfig(value, OPTIONS);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected parseConfig to refuse this value');
}
