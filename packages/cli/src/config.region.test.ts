import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';
import { rendererOptionsFor } from './commands/doctor.js';

/**
 * The timezone the page's clock reads in and the language it formats for.
 *
 * Both default to `UTC` and `en-US` in the renderer, never to the host's: the
 * same build on a laptop in Sydney and a runner in Virginia formats the same
 * date the same way. The config declares them for a project whose subjects are
 * written for another region, and the renderer the config builds carries them.
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

describe('the timezoneId and locale fields', () => {
  it('are absent by default, so the renderer keeps its own defaults', () => {
    const config = parseConfig(BASE, OPTIONS);

    expect(config.timezoneId).toBeUndefined();
    expect(config.locale).toBeUndefined();
    expect(rendererOptionsFor(config)).not.toHaveProperty('timezoneId');
    expect(rendererOptionsFor(config)).not.toHaveProperty('locale');
  });

  it('carry a declared timezone and language to the renderer', () => {
    const config = parseConfig({ ...BASE, timezoneId: 'Asia/Tokyo', locale: 'de-DE' }, OPTIONS);

    expect(rendererOptionsFor(config)).toMatchObject({ timezoneId: 'Asia/Tokyo', locale: 'de-DE' });
  });

  it('refuses a timezone the IANA database does not name, by the field', () => {
    expect(() => parseConfig({ ...BASE, timezoneId: 'Mars/Olympus' }, OPTIONS)).toThrow(
      /timezoneId.*Mars\/Olympus/s,
    );
  });

  it('refuses a language tag that is not BCP 47, by the field', () => {
    expect(() => parseConfig({ ...BASE, locale: 'en_US!' }, OPTIONS)).toThrow(/locale.*en_US!/s);
  });
});
