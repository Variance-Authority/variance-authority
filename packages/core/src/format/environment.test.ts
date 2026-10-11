import { describe, expect, it } from 'vitest';
import { diffEnvironments, environmentKey, type EnvironmentInputs } from './environment.js';

const INPUTS: EnvironmentInputs = {
  profile: 'chromium',
  engine: 'chromium@131',
  ruleset: 'r2',
  allowlist: 'a1',
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
  fonts: [],
  conditions: {},
  assets: {},
};

describe('environmentKey — the timezone and locale a page was read in', () => {
  it('splits both keys on a timezone or a locale, since either changes the text that is laid out', () => {
    const utc = environmentKey({ ...INPUTS, timezoneId: 'UTC', locale: 'en-US' });
    const tokyo = environmentKey({ ...INPUTS, timezoneId: 'Asia/Tokyo', locale: 'en-US' });
    const german = environmentKey({ ...INPUTS, timezoneId: 'UTC', locale: 'de-DE' });

    expect(tokyo.digest).not.toBe(utc.digest);
    expect(tokyo.semanticDigest).not.toBe(utc.semanticDigest);
    expect(german.digest).not.toBe(utc.digest);
    expect(german.semanticDigest).not.toBe(utc.semanticDigest);
  });

  it('keeps the key it had for a capture that chose neither', () => {
    // A jsdom capture names no timezone. Its key is the one it had before the field
    // existed, so adding the field invalidates only the captures that set it.
    expect(environmentKey({ ...INPUTS, timezoneId: undefined, locale: undefined }).digest).toBe(
      environmentKey(INPUTS).digest,
    );
  });

  it('names the timezone and the locale when it explains two keys', () => {
    const deltas = diffEnvironments(
      { ...INPUTS, timezoneId: 'UTC', locale: 'en-US' },
      { ...INPUTS, timezoneId: 'Asia/Tokyo', locale: 'de-DE' },
    );

    expect(deltas.map((delta) => delta.field)).toEqual(['timezoneId', 'locale']);
  });
});
