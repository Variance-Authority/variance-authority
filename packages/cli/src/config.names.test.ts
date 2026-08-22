import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

/**
 * The section that says what a subject id is made of.
 *
 * Worth its own file for the reason the browser field is: every refusal here is
 * a reading that would otherwise be silently wrong, and a silently wrong reading
 * of a name attaches a real difference to the wrong pair of subjects.
 */

const BASE = {
  project: 'acme',
  profile: 'chromium',
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
  retention: 'ephemeral',
  subjects: { kind: 'list', ids: ['a'], collector: 'c.mjs' },
  fonts: [],
  report: 'run.json',
};

const OPTIONS = { baseDir: '/tmp', file: 'variance.config.json', source: 'variance.config.json' };

const withNames = (names: unknown) => parseConfig({ ...BASE, names }, OPTIONS);

describe('the names section', () => {
  it('is absent by default, so names are read by the prefix rule', () => {
    expect(parseConfig(BASE, OPTIONS).names).toBeUndefined();
  });

  it('keeps the axes in the order they were written', () => {
    // The order is the reading. Reversed, `checkout-dark-ff-on` would be one
    // subject under a name the run assembles differently than the suite does.
    const config = withNames({
      axes: [
        { axis: 'scheme', values: ['light', 'dark'] },
        { axis: 'flag', values: ['ff-off', 'ff-on'] },
      ],
    });
    expect(config.names?.axes.map((axis) => axis.axis)).toEqual(['scheme', 'flag']);
  });

  it('refuses a value that belongs to two axes', () => {
    expect(() =>
      withNames({
        axes: [
          { axis: 'scheme', values: ['light', 'dark'] },
          { axis: 'mood', values: ['calm', 'dark'] },
        ],
      }),
    ).toThrow(/"dark".*"scheme".*"mood"/s);
  });

  it('refuses an axis nobody can differ on', () => {
    expect(() => withNames({ axes: [{ axis: 'scheme', values: ['light'] }] })).toThrow(
      /at least two values/,
    );
  });

  it('refuses the same axis named twice', () => {
    expect(() =>
      withNames({
        axes: [
          { axis: 'scheme', values: ['light', 'dark'] },
          { axis: 'scheme', values: ['a', 'b'] },
        ],
      }),
    ).toThrow(/"scheme" twice/);
  });

  it('refuses a section that configures nothing', () => {
    expect(() => withNames({ axes: [] })).toThrow(/non-empty array of axes/);
  });

  it('refuses a misspelled key by name', () => {
    expect(() => withNames({ axis: [{ axis: 'scheme', values: ['light', 'dark'] }] })).toThrow(
      /axes/,
    );
  });
});
