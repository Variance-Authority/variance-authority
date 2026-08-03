import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_GLOBAL } from './agent.js';
import { createHarness, type Harness, type HarnessOptions } from './harness.js';

/**
 * The harness's own tests, with no corpus in sight.
 *
 * The agent injected here is a dozen lines of hand-written JavaScript rather than
 * the kitchen-sink bundle, and deliberately so: this file must fail when the
 * *harness* is wrong, not when a fixture is. It also demonstrates the contract a
 * caller has to satisfy, which is the only documentation of that contract that
 * cannot go stale.
 *
 * Skipped rather than failed when Chromium is not downloaded. A machine with no
 * browser has not disproved anything, and a red suite that means "run
 * `npx playwright install chromium`" trains people to ignore red suites.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const VIEWPORT = { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' } as const;

/**
 * A minimal page agent.
 *
 * `renders` counts calls in page scope, so it survives a `page.evaluate` but not
 * a navigation — which is exactly the property the persistence test needs.
 */
const STUB_AGENT = `
(() => {
  let renders = 0;
  window[${JSON.stringify(AGENT_GLOBAL)}] = {
    capture(request) {
      renders += 1;
      const host = document.createElement('div');
      host.textContent = request.subject + '/' + request.variant;
      document.body.appendChild(host);
      const rect = host.getBoundingClientRect();
      host.remove();
      return JSON.stringify({
        captureVersion: 1,
        subject: { id: request.subjectId, kind: 'fixture' },
        profile: { id: 'chromium', ariaTree: true, declaredStyle: true, computedStyle: true, layout: true, raster: true },
        environment: {
          profile: 'chromium',
          engine: request.engine,
          viewport: request.viewport,
          fonts: request.fonts ?? [],
          conditions: { renders: renders },
          assets: {},
        },
        root: { tag: 'div', attributes: {}, matchedRules: [], rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, children: [] },
        inheritedSeed: {},
        diagnostics: [],
      });
    },
  };
})();
`;

const OPTIONS: HarnessOptions = {
  url: 'about:blank',
  bundle: STUB_AGENT,
  viewport: VIEWPORT,
  fonts: ['Stub/400/normal/0'],
};

describe.skipIf(!BROWSER_AVAILABLE)('createHarness', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness(OPTIONS);
  }, 60_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('names the engine so it can enter the environment key', () => {
    expect(harness.engine).toMatch(/^chromium@\d+\./);
  });

  it('keeps one page across subjects rather than reloading', async () => {
    // The claim is about *cost*, so it has to be tested by observing that page
    // state survived — not by counting navigations, which a caller cannot see.
    // `renders` lives in the agent's closure and a reload would reset it to 1.
    await harness.capture('alpha', 'base');
    const second = await harness.capture('beta', 'base');

    expect(second.environment.conditions['renders']).toBe(2);

    const third = await harness.capture('gamma', 'base');
    expect(third.environment.conditions['renders']).toBe(3);
  });

  it('returns a capture that survived a text transport', async () => {
    const capture = await harness.capture('alpha', 'base');

    // Not a tautology even though the agent stringifies: this asserts the value
    // the harness *hands back* is still plain data. ADR-0002's sub-renderer may
    // sit behind a pipe or an HTTP hop, so a capture that only survives a
    // structured clone is a capture that only works in-process.
    expect(() => JSON.parse(JSON.stringify(capture))).not.toThrow();
    expect(JSON.parse(JSON.stringify(capture))).toEqual(capture);
    expect(capture.profile.id).toBe('chromium');
  });

  it('observes real geometry, which is the whole reason this profile exists', async () => {
    const capture = await harness.capture('alpha', 'base');
    expect(capture.root.rect?.width).toBeGreaterThan(0);
  });

  it('reports nothing on the page console', () => {
    expect(harness.pageErrors()).toEqual([]);
  });
});

describe.skipIf(!BROWSER_AVAILABLE)('createHarness — failures', () => {
  it('says which global was missing rather than timing out', async () => {
    await expect(
      createHarness({ ...OPTIONS, bundle: '/* installs nothing */' }),
    ).rejects.toThrow(AGENT_GLOBAL);
  }, 60_000);

  it('surfaces a page-side throw instead of swallowing it', async () => {
    await expect(
      createHarness({ ...OPTIONS, bundle: 'throw new Error("bundle exploded");' }),
    ).rejects.toThrow(/bundle exploded/);
  }, 60_000);
});

// Announced at module scope, because that is the only place a reader of a
// skipped run sees anything. `it.skip` titles are invisible under the default
// reporter, which is the one CI uses.
if (!BROWSER_AVAILABLE) {
  console.warn(
    '\n@variance-authority/playwright (harness): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}
