import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  attributeRegions,
  formatSource,
  indexSource,
  isolateRegions,
  mergeSourceIndexes,
  rankRegions,
  resolveSource,
  type RankedRegion,
  type SourceIndex,
} from '@variance-authority/core/attribute';
import { diffSnapshots } from '@variance-authority/core/compare';
import type { SemanticSnapshot } from '@variance-authority/core/format';
import { buildDocket } from '@variance-authority/core/judge';
import { normalize } from '@variance-authority/core/rules';
import { comparePngs } from '@variance-authority/png';
import type { Harness } from '@variance-authority/playwright';
import { SCENARIOS, type Expectation, type Scenario, type Variant } from './scenarios.js';

/**
 * Our arm of the head-to-head: the run, not the scoring of it.
 *
 * Separated from `replacement.chromium.test.ts` so that the assertions there read
 * as assertions rather than as a driver with expectations buried in it. The order
 * of operations in here *is* the claim being tested, which is why it is one
 * function and not a set of helpers a test could reassemble differently: capture
 * before shooting, the cheap tier before the image, semantic causes before raster
 * collateral. Reorder any of those and the arm still produces findings — plausible,
 * complete, and about the wrong components.
 *
 * It takes the same screenshot of the same clip on the same page as the incumbent
 * did, and then keeps reading. `inspect` is deliberately *not* run here: the
 * baseline-free tier answers a different question and the test file asks it
 * separately, so that neither tier can be credited with the other's findings.
 */

export interface Finding extends Expectation {
  /** Names, deduplicated, in the order a report would print them. */
  readonly names: readonly string[];
  /** `component → file:line`, for the ones the source index resolves. */
  readonly files: readonly string[];
  /** Differing pixels under the default policy, or `null` when nothing was rendered. */
  readonly pixels: number | null;
  readonly regions: readonly RankedRegion[];
  /** `true` when the cheap tier settled it and no image was needed to. */
  readonly semanticOnly: boolean;
  readonly because: string;
}

/** What the arm needs to know about the page it is pointed at. */
export interface ArmOptions {
  /** This package, for the source index. Absolute, so a report is built from real files. */
  readonly packageRoot: string;
  /** The clip both arms shoot. Selector rather than a box: the box is read from it. */
  readonly clip: string;
  /** `deviceScaleFactor` — mask coordinates are device pixels, the tree's are CSS. */
  readonly scale: number;
}

export interface ArmRun {
  /** One finding per scenario, keyed by scenario id. */
  readonly findings: ReadonlyMap<string, Finding>;
  /**
   * Every scenario's post-edit snapshot, kept so the inspection arm can read the
   * broken render *without* the baseline the comparison arm needs.
   */
  readonly after: ReadonlyMap<string, SemanticSnapshot>;
  /** The pre-edit snapshots, for the scenarios that have one to record. */
  readonly before: ReadonlyMap<string, SemanticSnapshot>;
}

/** This case's own source, indexed by component name — the same way todomvc does it. */
function buildSourceIndex(packageRoot: string): SourceIndex {
  const directory = join(packageRoot, 'src');
  const files = readdirSync(directory).filter(
    (name) => /\.tsx?$/.test(name) && !name.includes('.test.') && !name.includes('.spec.'),
  );

  return mergeSourceIndexes(
    files.map((name) =>
      indexSource(relative(packageRoot, join(directory, name)), readFileSync(join(directory, name), 'utf8')),
    ),
  );
}

/** Capture and shoot the same mount, in that order. */
async function observe(
  harness: Harness,
  options: ArmOptions,
  scenario: Scenario,
  variant: Variant,
): Promise<{ snapshot: SemanticSnapshot; shot: Buffer; origin: { x: number; y: number } }> {
  // `capture` mounts and then collects, so the screenshot below is of the tree
  // this snapshot describes. Shooting first would photograph the previous
  // scenario and attribute this one's regions to it — a complete, plausible
  // report about the wrong components.
  const snapshot = normalize(await harness.capture(scenario.id, variant));
  const shot = await harness.page.locator(options.clip).screenshot();

  // Read rather than assumed. The snapshot's root is the mount host and the
  // screenshot is clipped to the box above it; the two share an origin only by
  // coincidence of this page's layout.
  const origin = await harness.page.evaluate((selector) => {
    const rect = window.document.querySelector(selector)!.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }, options.clip);

  return { snapshot, shot, origin };
}

export async function runOurArm(harness: Harness, options: ArmOptions): Promise<ArmRun> {
  const source = buildSourceIndex(options.packageRoot);

  const findings = new Map<string, Finding>();

  // Lower-cased on purpose, unlike the module-level maps they replace: this file
  // is source, and `buildSourceIndex` below reads every non-test file in `src/`
  // with a regex that takes any capitalised binding for a component. A local
  // called `AFTER` would enter this case's own component index.
  const afters = new Map<string, SemanticSnapshot>();
  const befores = new Map<string, SemanticSnapshot>();

  for (const scenario of SCENARIOS) {
    // The record phase, mirroring theirs: the new-subject scenario gets no
    // baseline, because the absence *is* the scenario.
    const baseline =
      scenario.baseline === 'none' ? null : await observe(harness, options, scenario, 'before');

    const after = await observe(harness, options, scenario, 'after');
    afters.set(scenario.id, after.snapshot);
    if (baseline !== null) befores.set(scenario.id, baseline.snapshot);

    if (baseline === null) {
      findings.set(scenario.id, {
        told: 'deferred',
        handed: 'no baseline',
        names: [],
        files: [],
        pixels: null,
        regions: [],
        semanticOnly: false,
        because: `no baseline for \`${scenario.id}\`; nothing to compare against`,
      });
      continue;
    }

    // The cheap tier first, and this ordering is the economic claim rather than
    // an implementation detail: three of these eight scenarios are settled here,
    // by two trees, with no image consulted on either side.
    const diff = diffSnapshots(baseline.snapshot, after.snapshot);
    const causes = buildDocket([diff]).entries.flatMap((entry) =>
      entry.components.filter((component) => component.role === 'root').map((component) => component.name),
    );

    const comparison = comparePngs(baseline.shot, after.shot);
    const pixels = comparison.changed['default'] ?? 0;
    const moved = pixels > 0 || comparison.dimensionsChanged;

    const regions = moved
      ? rankRegions(
          attributeRegions(isolateRegions(comparison.mask).regions, after.snapshot, {
            scale: options.scale,
            origin: after.origin,
          }),
          causes,
        )
      : [];

    if (diff.identical && !moved) {
      findings.set(scenario.id, {
        told: 'silent',
        handed: 'nothing',
        names: [],
        files: [],
        pixels,
        regions: [],
        semanticOnly: true,
        because: 'the two documents hash the same and no pixel differs',
      });
      continue;
    }

    // Semantic causes first: they are the ones with provenance. Raster regions
    // add the components the pixels landed in, which for a reflow is mostly
    // collateral — see `examples/todomvc/src/observe.chromium.test.ts`.
    const names = [
      ...new Set([
        ...causes,
        ...regions.map((region) => region.component).filter((name): name is string => name !== undefined),
      ]),
    ];

    findings.set(scenario.id, {
      told: 'told',
      handed: names.length > 0 ? 'components and files' : 'a number',
      names,
      files: names
        .map((name) => {
          const resolved = resolveSource(name, source);
          return resolved === null ? null : `${name} ${formatSource(resolved)}`;
        })
        .filter((line): line is string => line !== null),
      pixels,
      regions,
      semanticOnly: !moved,
      because: moved
        ? `${pixels} pixel(s) differ across ${regions.length} region(s)`
        : 'no pixel differs, and the documents do not hash the same',
    });
  }

  return { findings, after: afters, before: befores };
}
