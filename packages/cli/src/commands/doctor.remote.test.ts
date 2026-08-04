import { describe, expect, it } from 'vitest';
import { doctor } from './doctor.js';
import { exitForDiagnosis, formatDiagnosis } from './doctor-report.js';
import { EXIT_CLEAN } from '../exit.js';
import type { Config } from '../config.js';

/**
 * A renderer on another machine, seen from `doctor`.
 *
 * The command's position is that it makes no network calls, so a remote renderer
 * cannot be probed — and the interesting part is what it must *not* do about
 * that. Reporting `NOT AVAILABLE` would exit 2 on a machine where nothing is
 * wrong, and an operator who sees that for a working endpoint stops reading the
 * rest of the output.
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
  renderer: { endpoint: 'http://pinned-runner:7777' },
} as unknown as Config;

const PROBES = {
  renderer: () => {
    throw new Error('doctor must not open a renderer when one is configured elsewhere');
  },
  exists: async () => true,
  partitions: async () => [],
};

describe('doctor with a remote renderer', () => {
  it('never opens a local browser', async () => {
    // The probe throws rather than returning a fake: a test that let the wrong
    // call succeed quietly would pass while doctor launched Chromium on a machine
    // whose whole point is that it does not have to have one.
    await expect(doctor(CONFIG, PROBES)).resolves.toBeDefined();
  });

  it('says it did not check, rather than saying it failed', async () => {
    const diagnosis = await doctor(CONFIG, PROBES);

    expect(diagnosis.renderer.checked).toBe(false);
    expect(diagnosis.renderer.because).toContain('http://pinned-runner:7777');
    expect(diagnosis.renderer.because).toContain('not');
    expect(formatDiagnosis(diagnosis)).toContain('renderer: not checked');
  });

  it('exits clean, because an unasked question is not a failed one', async () => {
    expect(exitForDiagnosis(await doctor(CONFIG, PROBES))).toBe(EXIT_CLEAN);
  });

  it('reports no identity, because none was observed', async () => {
    // The rule the whole command turns on: every line is something it saw. An
    // identity reconstructed from config would be a guess about the far end, and
    // it is the value a baseline is partitioned by.
    expect((await doctor(CONFIG, PROBES)).renderer.identity).toBeUndefined();
  });

  it('probes no fonts, and says an empty list means nothing was measured', async () => {
    const fonts = (await doctor(CONFIG, PROBES)).fonts;

    expect(fonts.probed).toBe(false);
    expect(fonts.missing).toEqual([]);
    expect(fonts.asserted).toEqual(['Inter/400/normal/sha256-a']);
  });
});
