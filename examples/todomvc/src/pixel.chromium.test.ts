import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalize } from '@variance-authority/core';
import { createHarness, type Harness } from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { MUTATIONS } from './mutations.js';
import { STORY_IDS } from './stories.js';
import { comparePngs } from './pixel/diff.js';
import { PROBES } from './pixel/probes.js';
import { INSTABILITY_PROBES } from './pixel/instability.js';
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

interface Instability {
  readonly pixels: number;
  /**
   * Structure and style, *not* the render hash.
   *
   * The render hash folds in the environment key, so a legitimate environment
   * change moves it by construction — which would make "did the page's
   * representation change?" unanswerable for the probes that ask it.
   */
  readonly contentMoved: boolean;
  /** The two runs landed in different baseline slots, so they never meet. */
  readonly envKeyDiffers: boolean;
}

/** Instability probe id -> what each arm did across two runs of one commit. */
const INSTABILITY = new Map<string, Instability>();

async function mountOn(target: Harness, subject: string, variant: string): Promise<RenderResult> {
  const json = await target.page.evaluate(
    ([global, request]) =>
      (window as unknown as Record<string, { render: (r: unknown) => string }>)[
        global as string
      ]!.render(request),
    [AGENT_GLOBAL, { subject, variant }] as const,
  );
  return JSON.parse(json) as RenderResult;
}

async function mount(subject: string, variant: string): Promise<RenderResult> {
  return mountOn(harness!, subject, variant);
}

async function shootOn(target: Harness): Promise<Buffer> {
  return target.page.locator(CLIP).screenshot();
}

async function shoot(): Promise<Buffer> {
  return shootOn(harness!);
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
  // Instability: two runs of the *same code*, differing only in something a
  // pipeline does not control. This is what makes visual regression flaky in
  // practice, and it is the measurement the earlier "shoot twice, touch nothing"
  // round could not produce because it had removed every cause.
  for (const probe of INSTABILITY_PROBES) {
    const subject = PROBE_PREFIX + probe.id;

    const before = await mountAndShoot(subject, 'before');
    const beforeSnapshot = normalize(await harness.capture(subject, 'before'));

    let after: Buffer;
    let afterSnapshot: ReturnType<typeof normalize>;

    if (probe.secondHarnessDpr) {
      // A device pixel ratio belongs to the browser context, so the second run
      // needs its own browser. That is what makes it a faithful model of a
      // different CI runner rather than a CSS trick — and it is the only probe
      // here that cannot be expressed as a change to the page.
      const retina = await createHarness({
        url: HARNESS_PAGE_URL,
        bundle: agentBundle(),
        viewport: { ...VIEWPORT, deviceScaleFactor: 2 },
        fonts: ['system-ui/400/normal/todomvc'],
      });

      try {
        await mountOn(retina, subject, 'before');
        after = await shootOn(retina);
        afterSnapshot = normalize(await retina.capture(subject, 'before'));
      } finally {
        await retina.close();
      }
    } else {
      after = await mountAndShoot(subject, 'after');
      afterSnapshot = normalize(await harness.capture(subject, 'after'));
    }

    INSTABILITY.set(probe.id, {
      pixels: comparePngs(before, after).changed['default']!,
      contentMoved:
        beforeSnapshot.structureHash !== afterSnapshot.structureHash ||
        beforeSnapshot.styleHash !== afterSnapshot.styleHash,
      envKeyDiffers: beforeSnapshot.environment.digest !== afterSnapshot.environment.digest,
    });
  }
}, 300_000);

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

describe.skipIf(!BROWSER_AVAILABLE)('instability — two runs of the same commit', () => {
  /**
   * The correction to "the camera is not flaky".
   *
   * That claim came from shooting one mounted story twice, which is a statement
   * about a sensor and answers a question nobody has. Screenshots in a real
   * pipeline do not differ because the camera drifted; they differ because the
   * same commit rendered twice does not render identically — a font substitutes,
   * a runner is retina, a scrollbar appears, a clock advances.
   *
   * Each probe declares what *should* happen to both arms before it is measured,
   * so this is a scored prediction rather than a recording.
   */
  it.each(INSTABILITY_PROBES.map((probe) => probe.id))('%s behaves as declared', (id) => {
    const probe = INSTABILITY_PROBES.find((candidate) => candidate.id === id)!;
    const observed = INSTABILITY.get(id)!;

    expect(
      observed.pixels > 0 ? 'moves' : 'holds',
      `${id}: pixels — ${probe.rationale}`,
    ).toBe(probe.expect.pixels);

    expect(
      observed.contentMoved ? 'moves' : 'holds',
      `${id}: content — ${probe.rationale}`,
    ).toBe(probe.expect.content);

    if (probe.expectEnvKeyDiffers !== undefined) {
      expect(observed.envKeyDiffers, `${id}: environment key`).toBe(probe.expectEnvKeyDiffers);
    }
  });

  it('shows the pixel arm disturbed by things the semantic arm cannot see', () => {
    // Not a general claim that we are steadier. A specific one: rasterization
    // and device pixel ratio cannot reach a representation built from the box
    // tree, so they are absorbed by construction rather than by a threshold.
    const smoothing = INSTABILITY.get('text-smoothing')!;
    const dpr = INSTABILITY.get('device-pixel-ratio')!;

    expect(smoothing.pixels).toBeGreaterThan(0);
    expect(smoothing.contentMoved).toBe(false);
    expect(dpr.pixels).toBeGreaterThan(0);
    expect(dpr.contentMoved).toBe(false);
  });

  it('does not let the device-pixel-ratio case pass by accident', () => {
    // A 2x render genuinely *is* a different artifact, so "the hash held" would
    // be a false `unchanged` on its own. It is correct only because the two runs
    // address different baselines and never meet.
    expect(INSTABILITY.get('device-pixel-ratio')!.envKeyDiffers).toBe(true);
  });

  it('shows the semantic arm disturbed by something the camera ignores', () => {
    // The other direction, kept because a comparison that only ever finds in its
    // own favour is an advertisement. Reindenting JSX inside a block element
    // renders identically and moves our hash: distinguishing a block context from
    // an inline one needs layout, and the normalizer does not consult it.
    const whitespace = INSTABILITY.get('block-whitespace')!;

    expect(whitespace.pixels).toBe(0);
    expect(whitespace.contentMoved).toBe(true);
  });

  it('shows both arms disturbed where the change is real', () => {
    // A timestamp advancing is a genuine content change, and neither arm should
    // absorb it silently. What differs is the cost of a policy that does: a pixel
    // differ masks a coordinate region, which silences whatever else lands there;
    // the semantic arm masks the text node, which follows the content.
    const clock = INSTABILITY.get('clock')!;

    expect(clock.pixels).toBeGreaterThan(0);
    expect(clock.contentMoved).toBe(true);
  });

  it('records that headless cannot see a scrollbar reflow at all', () => {
    // Written expecting both arms to move; headless Chromium uses overlay
    // scrollbars, so growing the page leaves the subject exactly as wide. The
    // finding belongs to both arms: a headless pipeline is blind to a reflow
    // every headed user experiences, which inverts the usual "it only flakes in
    // CI" story for this cause.
    const scrollbar = INSTABILITY.get('scrollbar')!;

    expect(scrollbar.pixels).toBe(0);
    expect(scrollbar.contentMoved).toBe(false);
  });

  it('reports the instability table', () => {
    const rows = INSTABILITY_PROBES.map((probe) => {
      const observed = INSTABILITY.get(probe.id)!;
      const pixels = observed.pixels > 0 ? `moves (${observed.pixels}px)` : 'holds';
      const semantic = observed.contentMoved ? 'moves' : 'holds';

      return `  ${probe.id.padEnd(20)} ${pixels.padEnd(18)} ${semantic.padEnd(8)} ${probe.absorbedBy}`;
    });

    console.log(
      [
        '',
        'INSTABILITY — two runs of the same commit, one thing a pipeline cannot control',
        `  ${'source'.padEnd(20)} ${'pixel arm'.padEnd(18)} ${'ours'.padEnd(8)} absorbed by`,
        `  ${'-'.repeat(72)}`,
        ...rows,
        '',
      ].join('\n'),
    );

    expect(INSTABILITY.size).toBe(INSTABILITY_PROBES.length);
  });
});

// Announced at module scope, because that is the only place a reader of a
// skipped run sees anything. `it.skip` titles are invisible under the default
// reporter, which is the one CI uses.
if (!BROWSER_AVAILABLE) {
  console.warn(
    '\nexamples/todomvc (pixel arm): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}
