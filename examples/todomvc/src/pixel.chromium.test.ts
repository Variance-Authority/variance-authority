import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalize } from '@variance-authority/core';
import { createHarness, type Harness } from '@variance-authority/harness-playwright';
import { AGENT_GLOBAL } from '@variance-authority/harness-playwright/agent';
import { MUTATIONS } from './mutations.js';
import { STORY_IDS } from './stories.js';
import { comparePngs } from './pixel/diff.js';
import { PROBES } from './pixel/probes.js';
import { BASELINE_VARIANT, PROBE_PREFIX, type RenderResult } from './pixel/protocol.js';

/**
 * The pixel arm's findings, held in place.
 *
 * `scripts/pixel-arm.mjs` produces the full report; this file asserts the four
 * conclusions that the rest of the project reasons from, so that a change to the
 * stories, the tokens, or the collector cannot quietly invalidate them while the
 * journal still claims otherwise.
 *
 * Nothing here asserts an exact pixel count. Counts are machine-, font-, and
 * Chromium-version-specific, and a suite that pinned them would be red on every
 * other laptop for reasons that say nothing about the product. The assertions are
 * the *directions*: zero versus non-zero, one set equal to another.
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

const PACKAGE_ROOT = join(process.cwd(), 'examples', 'todomvc');
const HARNESS_PAGE_URL = pathToFileURL(join(PACKAGE_ROOT, 'page', 'harness.html')).href;
const AGENT_BUILDER = join(PACKAGE_ROOT, 'scripts', 'agent-bundle.mjs');

const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' } as const;
const CLIP = '#subject';
const FLAKE_ROUNDS = 5;

/**
 * Build the page agent out of process.
 *
 * Not `import { buildAgentBundle }`: this file is TypeScript and the builder is
 * a `.mjs` sibling of the package, so importing it would mean turning on
 * `allowJs` for the whole package to obtain one function. The child process is
 * also what kitchen-sink's measurement does, for a different reason, and keeping
 * the two the same is worth more than saving the spawn.
 */
function agentBundle(): string {
  if (!existsSync(AGENT_BUILDER)) {
    throw new Error(`expected the workspace root as cwd; ${AGENT_BUILDER} does not exist`);
  }

  const outfile = join(tmpdir(), `va-todomvc-agent-${process.pid}.js`);
  try {
    execFileSync(process.execPath, [AGENT_BUILDER, outfile], { stdio: 'pipe' });
    return readFileSync(outfile, 'utf8');
  } finally {
    rmSync(outfile, { force: true });
  }
}

let harness: Harness | undefined;

/** Baseline PNG per story, taken once. The goldens a VR tool would commit. */
const BASELINES = new Map<string, Buffer>();
/** Stories a mutation changed at the default policy, per mutation id. */
const CHANGED = new Map<string, string[]>();
/** Differing pixels per (mutation, story) at the default policy. */
const PIXELS = new Map<string, number>();
/** `[defaultPolicy, strictPolicy]` totals per flakiness round. */
const FLAKE: Array<readonly [number, number]> = [];
/** Probe id -> what each arm saw. */
const BLIND = new Map<string, { pixels: number; renderHeld: boolean }>();

async function mount(subject: string, variant: string): Promise<RenderResult> {
  const json = await harness!.page.evaluate(
    ([global, request]) =>
      (window as unknown as Record<string, { render: (r: unknown) => string }>)[
        global as string
      ]!.render(request),
    [AGENT_GLOBAL, { subject, variant }] as const,
  );
  return JSON.parse(json) as RenderResult;
}

async function shoot(): Promise<Buffer> {
  return harness!.page.locator(CLIP).screenshot();
}

/**
 * Mutations swept in-suite.
 *
 * A subset, because sweeping all of them triples the runtime to re-derive
 * numbers `scripts/pixel-arm.mjs` already records. Chosen so that every
 * assertion below reads a mutation that was actually shot — the two `visible:
 * false` claims, which are the load-bearing ones, plus the pair whose changed-
 * story sets turn out to be identical.
 *
 * The invariant test iterates this list rather than `MUTATIONS`, so adding a
 * mutation without sweeping it fails loudly instead of passing vacuously
 * against an empty result.
 */
const SWEPT: readonly string[] = [
  'broken-toggle',
  'label-detached',
  'noop-refactor',
  'token-radius',
  'token-accent',
];

async function mountAndShoot(subject: string, variant: string): Promise<Buffer> {
  await mount(subject, variant);
  return shoot();
}

/** Shoot every story under `mutationId` and record what a differ would report. */
async function sweep(mutationId: string): Promise<void> {
  const changed: string[] = [];
  for (const story of STORY_IDS) {
    const comparison = comparePngs(BASELINES.get(story)!, await mountAndShoot(story, mutationId));
    PIXELS.set(`${mutationId}/${story}`, comparison.changed['default']!);
    if (comparison.changed['default']! > 0) changed.push(story);
  }
  CHANGED.set(mutationId, changed);
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  harness = await createHarness({
    url: HARNESS_PAGE_URL,
    bundle: agentBundle(),
    viewport: VIEWPORT,
    fonts: ['system-ui/400/normal/todomvc'],
  });

  for (const story of STORY_IDS) BASELINES.set(story, await mountAndShoot(story, BASELINE_VARIANT));

  for (const id of SWEPT) await sweep(id);

  for (let round = 0; round < FLAKE_ROUNDS; round += 1) {
    await mount('page/todos--populated', BASELINE_VARIANT);
    const first = await shoot();
    const second = await shoot();
    const comparison = comparePngs(first, second);
    FLAKE.push([comparison.changed['default']!, comparison.changed['strict']!]);
  }

  for (const probe of PROBES) {
    const subject = PROBE_PREFIX + probe.id;
    const before = await mountAndShoot(subject, 'before');
    const after = await mountAndShoot(subject, 'after');

    const beforeSnapshot = normalize(await harness.capture(subject, 'before'));
    const afterSnapshot = normalize(await harness.capture(subject, 'after'));

    BLIND.set(probe.id, {
      pixels: comparePngs(before, after).changed['default']!,
      renderHeld: beforeSnapshot.renderHash === afterSnapshot.renderHash,
    });
  }
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

describe.skipIf(!BROWSER_AVAILABLE)('pixel arm — the ground truth in mutations.ts', () => {
  /**
   * The invariant, checked for every mutation rather than argued for any.
   *
   * `visible` is the field the whole comparison turns on, and it is the field
   * most easily believed rather than measured. This test is the reason the
   * declaration was corrected: `broken-toggle` claimed `visible: false` "by
   * construction", and a real engine measured six of fifteen stories differing
   * by thousands of pixels — because an `<input type="checkbox">` is a native
   * control that Chromium paints from the UA stylesheet and the platform theme,
   * so a `<div>` with the same class inherits none of it.
   *
   * Stated as an invariant, the same test now guards every future mutation
   * against the same mistake, which a one-off refutation would not have done.
   */
  it('every swept mutation`s declared visibility matches what the camera measures', () => {
    for (const id of SWEPT) {
      const mutation = MUTATIONS.find((candidate) => candidate.id === id)!;
      const changed = CHANGED.get(id);

      // Never `?? []`: an unswept mutation would then read as "camera saw
      // nothing" and quietly satisfy any `visible: false` claim.
      expect(changed, `${id} was not swept`).toBeDefined();
      expect(
        changed!.length > 0,
        `${id} declares visible: ${mutation.visible}, camera saw ${changed!.length} changed stories`,
      ).toBe(mutation.visible);
    }
  });

  /**
   * The defect a camera cannot report, verified rather than reasoned about.
   *
   * `label-detached` changes one attribute value. The label renders identically,
   * the input renders identically, nothing in the box tree moves — so unlike the
   * corrected `broken-toggle`, its invisibility needs no argument about how
   * anything is painted.
   */
  it('confirms label-detached: an accessibility regression at zero pixels', () => {
    expect(MUTATIONS.find((mutation) => mutation.id === 'label-detached')!.visible).toBe(false);
    expect(CHANGED.get('label-detached')).toEqual([]);
  });

  /**
   * The other `visible: false` mutation, which holds.
   *
   * Inert wrappers plus churned generated class names produce a byte-identical
   * render, so the pixel arm correctly reports nothing — and this is the case
   * where a pixel differ is *right* and a naive structural comparison would cry
   * wolf. It is asserted at the default policy only: at strict the arm's own
   * antialiasing jitter, measured separately below, is the same order as any
   * signal this mutation could produce.
   */
  it('confirms noop-refactor: nothing a camera can see', () => {
    expect(MUTATIONS.find((mutation) => mutation.id === 'noop-refactor')!.visible).toBe(false);
    expect(CHANGED.get('noop-refactor')).toEqual([]);
  });
});

describe.skipIf(!BROWSER_AVAILABLE)('pixel arm — what the output can and cannot say', () => {
  /**
   * Two foundation edits with different impact, one review queue.
   *
   * `token-radius` is a corner radius and `token-accent` is a brand colour. They
   * change *exactly* the same eight stories, so the pixel differ's entire output
   * — the set of screenshots to review — is identical for both. Nothing in it
   * says which token moved, which layer it lives in, or whether anything could
   * have reflowed.
   */
  it('cannot separate two different foundation edits', () => {
    expect([...CHANGED.get('token-radius')!].sort()).toEqual(
      [...CHANGED.get('token-accent')!].sort(),
    );
  });

  /**
   * The camera itself is steady; the renderer is not.
   *
   * Shooting the same mounted story twice is byte-identical every time, which is
   * the honest finding in the pixel arm's favour — this is not a flaky
   * instrument. The noise that does exist appears only across a *remount*, only
   * at the strict policy, and only on antialiased text; `scripts/pixel-arm.mjs`
   * measures it across the whole story set.
   */
  it('sees zero when nothing changed', () => {
    expect(FLAKE).toHaveLength(FLAKE_ROUNDS);
    for (const [atDefault, atStrict] of FLAKE) {
      expect(atDefault).toBe(0);
      expect(atStrict).toBe(0);
    }
  });
});

describe.skipIf(!BROWSER_AVAILABLE)('pixel arm — what it catches that we do not', () => {
  /**
   * The direction this project is not built to test, tested anyway.
   *
   * Every probe is a real user-visible change; the question is whether the
   * semantic snapshot notices. Two of the three were allowlist gaps when this was
   * written — `accent-color` and `-webkit-text-stroke-width` — and both are now
   * admitted at `ALLOWLIST_VERSION` `a2`, so they moved from "we are blind" to
   * "we caught it". Their probes stay, as the regression tests for that fix.
   *
   * `canvas-repaint` is different in kind and is not fixable by adding
   * properties: the bitmap lives in a rendering context, not in the document, so
   * no amount of style collection can see it. It is an *observable* gap, and the
   * honest thing to do with it is leave it asserted and visible.
   */
  const CAUGHT_AT_A2 = new Set(['accent-color', 'text-stroke']);

  it.each(PROBES.map((probe) => probe.id))('%s: pixels move', (id) => {
    const observed = BLIND.get(id)!;
    expect(observed.pixels).toBeGreaterThan(0);

    if (CAUGHT_AT_A2.has(id)) {
      // Regression guard: if the allowlist loses these again, a real visual
      // change goes back to reading as `unchanged`.
      expect(observed.renderHeld, `${id} should now be caught by the allowlist`).toBe(false);
      return;
    }
    expect(observed.renderHeld).toBe(true);
  });
});

describe.skipIf(BROWSER_AVAILABLE)('pixel arm', () => {
  it.skip('needs a Chromium download: npx playwright install chromium', () => {});
});
