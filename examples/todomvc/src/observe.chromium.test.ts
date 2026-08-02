import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attributeRegions,
  formatSource,
  buildDocket,
  diffSnapshots,
  isolateRegions,
  normalize,
  rankRegions,
  resolveSource,
  type RankedRegion,
  type SemanticSnapshot,
} from '@variance-authority/core';
import { comparePngs } from '@variance-authority/png';
import { handle, writeRunReport, type RunReport } from '@variance-authority/mcp';
import { createHarness, type Harness } from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { BASELINE_VARIANT } from './pixel/protocol.js';
import { buildSourceIndex } from './source-index.js';
import { mkdtemp, rm } from 'node:fs/promises';

/**
 * The pixel tier, made observable: **pixels → region → node → component → file.**
 *
 * The pixel arm's own measurement (`pixel.chromium.test.ts`) ends where every
 * pixel differ ends — at a number. 5482 pixels changed across six stories. That
 * number is why "looks right, merge" exists: it cannot be assigned to anyone, so
 * the only available response is to open the image and look, which is the
 * expensive act the tool was supposed to replace.
 *
 * This file takes the same images and runs the rest of the chain on them. The
 * comparison stops at a mask rather than a count; the mask clusters into regions;
 * the regions are joined to the box tree; the tree already knows which component
 * produced each node; and the component resolves to a file. Nothing new is
 * rendered — it is the same two screenshots, read further.
 *
 * Note what is *not* here: no new observation. The semantic tier already reports
 * this change without taking a screenshot at all. What this proves is that when
 * a screenshot is genuinely needed — the residue the cheap tier cannot settle —
 * it does not have to arrive as an unassignable number.
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

/** A populated list, so the change has somewhere to repeat. */
const STORY = 'page/todos--populated';

/**
 * The Toggle edit, measured at 5482 differing pixels across 6 of 15 stories.
 *
 * Chosen because it is the case the pixel arm handles *well* — it is plainly
 * visible, so nobody has to argue about whether a differ should have caught it.
 * The question here is not detection. It is what the reader is handed afterwards.
 */
const MUTATION = 'broken-toggle';

function agentBundle(): string {
  if (!existsSync(AGENT_BUILDER)) {
    throw new Error(`expected the workspace root as cwd; ${AGENT_BUILDER} does not exist`);
  }

  const outfile = join(tmpdir(), `va-todomvc-observe-${process.pid}.js`);
  try {
    execFileSync(process.execPath, [AGENT_BUILDER, outfile], { stdio: 'pipe' });
    return readFileSync(outfile, 'utf8');
  } finally {
    rmSync(outfile, { force: true });
  }
}

const SOURCE = buildSourceIndex();

let harness: Harness | undefined;
let regions: readonly RankedRegion[] = [];
/** Roots the semantic tier named for the same change. The ranking comes from here. */
let causes: readonly string[] = [];
let changedPixels = 0;
let regionCount = 0;

async function mount(subject: string, variant: string): Promise<void> {
  await harness!.page.evaluate(
    ([global, request]) =>
      (window as unknown as Record<string, { render: (r: unknown) => string }>)[
        global as string
      ]!.render(request),
    [AGENT_GLOBAL, { subject, variant }] as const,
  );
}

async function shoot(): Promise<Buffer> {
  return harness!.page.locator(CLIP).screenshot();
}

/**
 * Top-left of the clipped screenshot, in page coordinates.
 *
 * Read rather than assumed. The snapshot's root is the mount host and the
 * screenshot is clipped to `#subject` above it, so the two coordinate spaces
 * share an origin only by coincidence of the page's layout — and a silently
 * wrong origin produces a complete, plausible report about the wrong components.
 */
async function clipOrigin(): Promise<{ x: number; y: number }> {
  return harness!.page.evaluate((selector) => {
    const rect = window.document.querySelector(selector)!.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }, CLIP);
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  harness = await createHarness({
    url: HARNESS_PAGE_URL,
    bundle: agentBundle(),
    viewport: VIEWPORT,
    fonts: ['system-ui/400/normal/todomvc'],
  });

  // The baseline screenshot and the snapshot describing it. Same page, same
  // mount — the geometry the regions are joined against has to be the geometry
  // the pixels were taken from, or the join is against a different layout.
  await mount(STORY, BASELINE_VARIANT);
  const before = await shoot();
  const origin = await clipOrigin();

  const snapshot: SemanticSnapshot = normalize(await harness.capture(STORY, BASELINE_VARIANT));

  await mount(STORY, MUTATION);
  const after = await shoot();

  // The same change, sensed semantically. Not a second observation for its own
  // sake: geometry can say where pixels are and cannot say which of them is the
  // cause, so the ordering has to come from the tier that has provenance.
  const mutated: SemanticSnapshot = normalize(await harness.capture(STORY, MUTATION));
  causes = buildDocket([diffSnapshots(snapshot, mutated)]).entries.flatMap((entry) =>
    entry.components.filter((component) => component.role === 'root').map((c) => c.name),
  );

  const comparison = comparePngs(before, after);
  changedPixels = comparison.changed['default'] ?? 0;

  const isolation = isolateRegions(comparison.mask);
  regionCount = isolation.regions.length;

  regions = rankRegions(
    attributeRegions(isolation.regions, snapshot, {
      scale: VIEWPORT.deviceScaleFactor,
      origin,
    }),
    causes,
  );
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

chromium_('reading a pixel diff further than a number', () => {
  it('sees the change at all, which is the part a pixel differ already does', () => {
    expect(changedPixels).toBeGreaterThan(0);
  });

  it('clusters the differing pixels into places rather than reporting a count', () => {
    // Fewer regions than differing pixels by orders of magnitude, and more than
    // zero. A single region for a change repeated down a list would mean the
    // clustering swallowed the structure; one region per changed pixel would
    // mean it did nothing.
    expect(regionCount).toBeGreaterThan(0);
    expect(regionCount).toBeLessThan(changedPixels);
  });

  it('lands every region somewhere in the tree', () => {
    // `unattributed` here would mean the scale or the origin is wrong, which is
    // the failure that still produces a complete and entirely misdirected report.
    expect(regions.filter((region) => region.unattributed)).toHaveLength(0);
  });

  it('names the component the pixels belong to', () => {
    const named = new Set(regions.map((region) => region.component).filter(Boolean));
    expect([...named]).toContain('Toggle');
  });

  it('ranks causes above collateral, which area alone does not', () => {
    // The finding this file exists to record.
    //
    // Ranked by area the report reads Text (933px), Stack (511px), Toggle
    // (86px). Every one of those attributions is correct — the pixels really
    // are inside those nodes — and the ordering is still wrong, because area
    // measures *displacement*. Replacing the checkbox with a styled div moves
    // far more of what sits around it than of itself, so `Stack`, which merely
    // got reflowed, outranks `Toggle`, which is the edit.
    //
    // Geometry cannot fix this; it has no access to why. The semantic tier does,
    // so the ordering is taken from there and the raster regions become evidence
    // rather than the verdict.
    const byArea = [...regions].sort((a, b) => b.region.pixels - a.region.pixels);
    const areaOrder = byArea.map((region) => region.component);
    expect(areaOrder.indexOf('Stack')).toBeLessThan(areaOrder.indexOf('Toggle'));

    expect(causes).toContain('Toggle');
    expect(regions[0]!.cause).toBe(true);

    const lastCause = regions.findLastIndex((region) => region.cause);
    const firstCollateral = regions.findIndex((region) => !region.cause);
    expect(firstCollateral === -1 || lastCause < firstCollateral).toBe(true);
  });

  it('does not pretend the semantic tier names exactly one cause', () => {
    // It names two here, and both are real: the edit replaces a native control
    // with a styled div, so `Toggle` restructured and the `Text` beside it did
    // too. Collapsing that to a single culprit would be tidier and would be the
    // system inventing a fact it does not have.
    expect([...causes].sort()).toEqual(['Text', 'Toggle']);
  });

  it('says where each region is in landmarks a person would use', () => {
    const located = regions.filter((region) => region.where !== undefined && region.where !== '');
    expect(located.length).toBeGreaterThan(0);
    expect(located[0]!.where).toMatch(/main|list|region|checkbox/);
  });

  it('resolves the named component to a file an editor can open', () => {
    const resolved = resolveSource('Toggle', SOURCE);

    expect(resolved).not.toBeNull();
    expect(formatSource(resolved!)).toMatch(/^src\/ds\/components\.tsx:\d+$/);
  });

  it('prints the report', () => {
    const byComponent = new Map<
      string,
      { pixels: number; count: number; cause: boolean; where?: string }
    >();

    for (const region of regions) {
      const key = region.component ?? region.path ?? 'unattributed';
      const entry = byComponent.get(key) ?? {
        pixels: 0,
        count: 0,
        cause: region.cause,
        ...(region.where !== undefined ? { where: region.where } : {}),
      };
      byComponent.set(key, {
        ...entry,
        pixels: entry.pixels + region.region.pixels,
        count: entry.count + 1,
      });
    }

    const lines = [...byComponent.entries()]
      .sort((a, b) => Number(b[1].cause) - Number(a[1].cause) || b[1].pixels - a[1].pixels)
      .map(([component, entry]) => {
        const file = resolveSource(component, SOURCE);
        return [
          `  ${entry.cause ? 'cause     ' : 'collateral'}  ${entry.pixels}px in ${entry.count} region(s) — ${component}`,
          entry.where !== undefined ? `      in ${entry.where}` : null,
          file !== null ? `      ${formatSource(file)}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n');
      });

    console.log(
      [
        '',
        `--- ${MUTATION} on ${STORY}`,
        `what a pixel differ reports:  ${changedPixels} pixels changed`,
        `what this reports:            ${regionCount} region(s)`,
        ...lines,
      ].join('\n'),
    );

    expect(lines.length).toBeGreaterThan(0);
  });

  it('hands the finding to an agent through the MCP tools', async () => {
    // The last hop, and the one the whole chain is for. The change was sensed in
    // a browser that has since closed, in a process that is about to end. An
    // agent asked to fix it arrives afterwards with none of that — so the run
    // writes a report, and the tools answer from the file.
    const report: RunReport = {
      runVersion: 1,
      at: '2026-08-01T00:00:00.000Z',
      identity: {
        renderer: 'playwright-chromium',
        engine: harness!.engine,
        platform: `${process.platform}/${process.arch}`,
        deviceScaleFactor: VIEWPORT.deviceScaleFactor,
        fonts: ['system-ui/400/normal/todomvc'],
      },
      retention: 'ephemeral',
      intent: `${MUTATION} applied to the design system`,
      observations: [
        {
          subject: STORY,
          verdict: 'changed',
          because: `${changedPixels} pixel(s) differ across ${regionCount} region(s)`,
          changedPixels,
          regions: regions.map((region) => {
            const file = region.component === undefined ? null : resolveSource(region.component, SOURCE);
            return {
              x: region.region.x,
              y: region.region.y,
              width: region.region.width,
              height: region.region.height,
              pixels: region.region.pixels,
              cause: region.cause,
              ...(region.component !== undefined ? { component: region.component } : {}),
              ...(region.where !== undefined ? { where: region.where } : {}),
              ...(file !== null ? { file: formatSource(file) } : {}),
            };
          }),
        },
      ],
    };

    const directory = await mkdtemp(join(tmpdir(), 'va-observe-'));
    try {
      await writeRunReport(join(directory, 'run.json'), report);

      const answer = handle(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'variance_describe', arguments: { subject: STORY } },
        },
        () => report,
      );
      const text = (answer!.result as { content: { text: string }[] }).content[0]!.text;

      console.log(`\n--- what an agent is handed\n${text}`);

      // The three things a finding needs to become an edit.
      expect(text).toContain('Toggle');
      expect(text).toContain('src/ds/components.tsx:');
      expect(text.indexOf('cause')).toBeLessThan(text.indexOf('collateral'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
