import { describe, expect, it } from 'vitest';
import { rendererOptionsFor } from './doctor.js';
import type { Config } from '../config.js';

/**
 * The renderer options, pinned because two call sites read them.
 *
 * `doctor` and `bin`'s `rendererFor` both have to answer *what does the config
 * say about the renderer*, and for one commit they answered differently: the
 * `browser` field landed, `bin` read it, and `doctor` went on launching Chromium.
 * The consequence is the worst shape a diagnostic can take — a green *a renderer
 * opened* handed to an operator whose run is about to fail on a WebKit that is
 * not installed.
 */

const CONFIG = {
  project: 'acme',
  profile: 'chromium',
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
  retention: 'ephemeral',
  subjects: { kind: 'list', ids: ['a'], collector: 'c.mjs' },
  fonts: ['Inter/400/normal/sha256-a'],
  report: 'run.json',
  images: 'images',
} as unknown as Config;

describe('rendererOptionsFor', () => {
  it('carries the fonts, which is what the identity is partitioned by', () => {
    expect(rendererOptionsFor(CONFIG).fonts).toEqual(['Inter/400/normal/sha256-a']);
  });

  it('omits the engine when the config does not name one', () => {
    // Omitted rather than defaulted: writing `chromium` here would make the
    // renderer's own default unreachable and turn one decision into two that
    // have to agree forever.
    expect(rendererOptionsFor(CONFIG).browser).toBeUndefined();
  });

  it('carries the engine the config named, so the probe launches what the run will', () => {
    expect(rendererOptionsFor({ ...CONFIG, browser: 'webkit' }).browser).toBe('webkit');
  });
});
