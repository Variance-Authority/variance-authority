import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

/**
 * The one config field that decides which engine paints.
 *
 * Worth its own file because it is the field that turns a library capability
 * into a product one: `variance run` launched Chromium unconditionally, so
 * cross-engine coverage existed only for a caller composing the pieces by hand —
 * which is nobody running the binary.
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

const OPTIONS = { baseDir: '/tmp', file: 'variance.config.json' };

describe('the browser field', () => {
  it('is absent by default, so the renderer keeps its own default', () => {
    // Absent rather than defaulted to `"chromium"` here: a config that writes the
    // default down makes the renderer's default unreachable and turns one
    // decision into two that must agree forever.
    expect(parseConfig(BASE, OPTIONS).browser).toBeUndefined();
  });

  it.each(['chromium', 'firefox', 'webkit'])('accepts %s', (browser) => {
    expect(parseConfig({ ...BASE, browser }, OPTIONS).browser).toBe(browser);
  });

  it('refuses an engine nobody can launch, by name', () => {
    // The failure this prevents is not a typo caught late. An unknown engine that
    // parsed would reach `createPlaywrightRenderer`, fail there, and exit `2` —
    // an operator error, correctly, but from a stack trace about a browser
    // instead of a sentence about a config field.
    expect(() => parseConfig({ ...BASE, browser: 'safari' }, OPTIONS)).toThrow(
      /browser.*chromium, firefox, webkit.*safari/s,
    );
  });
});
