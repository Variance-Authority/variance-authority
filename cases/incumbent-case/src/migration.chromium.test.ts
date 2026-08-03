import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attributeRegions,
  buildDocket,
  diffSnapshots,
  formatSource,
  indexSource,
  isolateRegions,
  mergeSourceIndexes,
  normalize,
  rankRegions,
  resolveSource,
  type SourceIndex,
} from '@variance-authority/core';
import { comparePngs } from '@variance-authority/png';
// @ts-expect-error — a plain .mjs script, deliberately not part of the TS build.
import { stale } from '../scripts/bundle.mjs';
import { createHarness, type Harness } from '@variance-authority/playwright';
import { SCENARIOS } from './scenarios.js';

/**
 * Can a team actually leave?
 *
 * The other case file asks whether we answer better. That is only half of
 * "replace" and it is the easier half: a tool nobody can migrate *to* has not
 * replaced anything, however good its answers are. So this file starts from the
 * artifact a team already has — a directory of PNGs their own runner recorded,
 * on their own machine, in their own workflow — and asks what can be done with it
 * without re-recording anything.
 *
 * The baselines read here were written by `playwright test --update-snapshots` in
 * `scripts/incumbent.mjs`. Nothing in this file produced them and nothing here
 * converts them.
 *
 * **The answer has two halves, and the second one is the finding.** Their
 * baselines are ordinary PNGs, so the reading end takes them as they are and
 * produces the named, file-resolved report the count could not. But a foreign
 * baseline arrives with **no identity attached** — no engine, no scale factor, no
 * font list, no platform — and identity is what `incomparable` is decided from.
 * So an imported baseline is comparable *by assumption*, which is exactly the
 * confident-wrong-answer this project refuses everywhere it controls the artifact.
 *
 * That is a real cost of migration, it is measured below rather than argued, and
 * it points at the only honest way to spend it: import to get moving, and let the
 * imported generation age out as subjects are re-recorded under an identity.
 */

const PACKAGE_ROOT = join(process.cwd(), 'cases', 'incumbent-case');
const PAGE_URL = pathToFileURL(join(PACKAGE_ROOT, 'page', 'case.html')).href;
const BUNDLE = join(PACKAGE_ROOT, 'dist', 'case.js');

/** Written by their runner, under the path template in `playwright.config.ts`. */
const THEIRS = join(PACKAGE_ROOT, 'incumbent', 'baselines', 'strict');

const VIEWPORT = { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' } as const;
const CLIP = '#subject';

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

// Gated on `stale()` like the other two suites. It reads the same `case.js`,
// so a bundle they refuse is one it must not quietly measure against.
const STALE = stale();
const READY = BROWSER_AVAILABLE && existsSync(BUNDLE) && existsSync(THEIRS) && STALE === null;

function buildSourceIndex(): SourceIndex {
  const directory = join(PACKAGE_ROOT, 'src');
  return mergeSourceIndexes(
    readdirSync(directory)
      .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.') && !name.includes('.spec.'))
      .map((name) =>
        indexSource(
          relative(PACKAGE_ROOT, join(directory, name)),
          readFileSync(join(directory, name), 'utf8'),
        ),
      ),
  );
}

const SOURCE = buildSourceIndex();

/** The scenario to read their baseline for. Detected by both arms, so the */
/* comparison is purely about what each hands over afterwards. */
const SUBJECT = 'space-token-nudged';

let harness: Harness | undefined;
let report = '';
let named: readonly string[] = [];
let theirPixels = 0;

/** The ordering an import can produce: area, because there is no provenance. */
let byArea: readonly string[] = [];
/** The ordering a re-recorded subject produces: causes first. */
let byCause: readonly string[] = [];

beforeAll(async () => {
  if (!READY) return;

  harness = await createHarness({
    url: PAGE_URL,
    bundle: readFileSync(BUNDLE, 'utf8'),
    viewport: VIEWPORT,
    fonts: ['ui-sans-serif/400/normal/incumbent-case'],
  });

  // Their artifact, straight off the disk. No conversion, no re-record, no
  // second baseline directory — this is the file their CI committed.
  const baseline = readFileSync(join(THEIRS, `${SUBJECT}.png`));

  // Our side of the comparison: the current state of the same subject, shot the
  // way their spec shoots it.
  const scenario = SCENARIOS.find((candidate) => candidate.id === SUBJECT)!;
  const after = normalize(await harness.capture(scenario.id, 'after'));
  const shot = await harness.page.locator(CLIP).screenshot();
  const origin = await harness.page.evaluate((selector) => {
    const rect = window.document.querySelector(selector)!.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }, CLIP);

  const comparison = comparePngs(baseline, shot);
  theirPixels = comparison.changed['default'] ?? 0;

  // Everything to this point used their PNG and nothing else. Regions, the
  // components the pixels landed in, and the files those resolve to are all
  // available from an imported baseline.
  const attributed = attributeRegions(isolateRegions(comparison.mask).regions, after, {
    scale: VIEWPORT.deviceScaleFactor,
    origin,
  });

  named = [
    ...new Set(
      attributed.map((region) => region.component).filter((name): name is string => name !== undefined),
    ),
  ];

  // `unattributed` and `no component` are different failures and are kept apart:
  // the first means the region did not land in the tree at all, which would mean
  // the scale or the origin is wrong; the second means it landed on a node no
  // component owns, which is ordinary — the panel's own background is not
  // anybody's element.
  const label = (region: (typeof attributed)[number]): string =>
    region.unattributed ? '«off-tree»' : (region.component ?? '«no component»');

  byArea = [...attributed]
    .sort((left, right) => right.region.pixels - left.region.pixels)
    .map(label);

  // And this is what an import cannot reach. Ranking cause above collateral
  // needs a semantic *baseline*, and a PNG is not one — so the `before`
  // snapshot has to be collected live here, which on a real migration is
  // precisely the thing that does not exist yet for an imported subject.
  const before = normalize(await harness.capture(scenario.id, 'before'));
  const causes = buildDocket([diffSnapshots(before, after)]).entries.flatMap((entry) =>
    entry.components.filter((component) => component.role === 'root').map((component) => component.name),
  );

  const ranked = rankRegions(attributed, causes);
  byCause = ranked.map(label);

  report = [
    '',
    `--- ${SUBJECT}, read from a baseline Playwright recorded`,
    `  their baseline      incumbent/baselines/strict/${SUBJECT}.png (${baseline.length} bytes)`,
    `  what it says        ${theirPixels} pixels changed`,
    `  what we add         ${attributed.length} region(s), ` +
      `${attributed.filter((region) => region.unattributed).length} of them off-tree`,
    ...ranked.slice(0, 6).map((region) => {
      const file = region.component === undefined ? null : resolveSource(region.component, SOURCE);
      return (
        `  ${region.cause ? 'cause     ' : 'collateral'}  ` +
        `${String(region.region.pixels).padStart(5)}px — ${label(region).padEnd(14)}` +
        (file === null ? '' : ` ${formatSource(file)}`)
      );
    }),
    '',
  ].join('\n');
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

const live = READY ? describe : describe.skip;

if (!READY) {
  console.warn(
    '\ncases/incumbent-case (migration): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(BUNDLE) ? '' : '\n  no page bundle') +
      (existsSync(THEIRS) ? '' : '\n  the incumbent has not recorded a baseline') +
      (STALE === null ? '' : `\n  ${STALE}`) +
      '\n  yarn workspace @variance-authority/case-incumbent incumbent\n',
  );
}

live('a baseline the incumbent recorded', () => {
  it('is an ordinary PNG, so there is nothing to convert', () => {
    // The whole reason migration is cheap, stated as the fact it rests on: their
    // artifact format is not a format. A tool whose baselines are a proprietary
    // blob, or live only behind an API, is a tool whose exit cost is a
    // re-recording of every subject — which is the cost that keeps teams where
    // they are.
    const files = readdirSync(THEIRS);
    expect(files).toContain(`${SUBJECT}.png`);
    expect(files.every((name) => name.endsWith('.png'))).toBe(true);
    expect(statSync(join(THEIRS, `${SUBJECT}.png`)).size).toBeGreaterThan(0);
  });

  it('answers with components and files, without being re-recorded', () => {
    // The migration claim in one assertion: their baseline in, our report out,
    // and no baseline of ours anywhere in it. What the count could not say —
    // *which component, in which file* — is available from the artifact a team
    // already has, on the first run, before anything is re-recorded.
    expect(theirPixels).toBeGreaterThan(0);
    expect(named.length).toBeGreaterThan(0);

    const unresolved = named.filter((name) => resolveSource(name, SOURCE) === null);
    expect(unresolved).toEqual([]);

    console.log(report);
  });

  it('cannot supply the ordering, because a PNG is not a semantic baseline', () => {
    // The second cost, and the sharper one.
    //
    // Attribution needs one snapshot — of the current state — so it survives the
    // import intact. *Ranking* needs a semantic baseline, because cause and
    // collateral are decided by what the two documents say and not by where the
    // pixels are. An imported subject has no such baseline, so its regions can
    // only be ordered by area — which is the ordering `examples/todomvc`
    // measured as backwards, since area measures displacement and the displaced
    // outrank the displacer.
    expect(byArea.length).toBeGreaterThan(0);
    expect(byCause.length).toBe(byArea.length);

    // Both orderings are over the same regions; only the sequence differs.
    expect([...byCause].sort()).toEqual([...byArea].sort());

    console.log(
      '\n--- the same regions, ordered two ways' +
        `\n  by area (what an import can do)     ${byArea.join(' > ')}` +
        `\n  by cause (needs a semantic baseline) ${byCause.join(' > ')}` +
        `\n  same order?                          ${byArea.join() === byCause.join() ? 'yes' : 'no'}\n`,
    );
  });

  it('carries no identity, which is what migration actually costs', () => {
    // The honest half. A durable baseline of ours is stored partitioned by
    // renderer identity so that a run on a different machine is `incomparable`
    // — one sentence — rather than every subject failing for reasons nobody can
    // attribute (ADR-0011).
    //
    // A foreign baseline has none of that. The directory name is a project name
    // the operator chose, the file name is the subject, and nothing anywhere
    // states the engine, the scale factor or the fonts it was painted with. So
    // an imported baseline can only be compared *by assumption*, and the verdict
    // that protects against a wrong assumption is unavailable for exactly as
    // long as the import lasts.
    const carried = readdirSync(THEIRS).map((name) => name.replace(/\.png$/, ''));
    const subjects = SCENARIOS.filter((s) => s.baseline === 'recorded').map((s) => s.id);

    // Everything their layout encodes is a subject id. Nothing else.
    expect([...carried].sort()).toEqual([...subjects, 'unseen-subject'].sort());

    // Not a defect in their design — a screenshot assertion has no identity to
    // record, because it never compares across machines by construction: the
    // baseline and the run are the same CI image, or the suite is already red.
    // It becomes a cost the moment the baseline outlives that assumption.
    console.log(
      '\n--- what an imported baseline cannot say' +
        '\n  engine             (absent) — which chromium painted it' +
        '\n  deviceScaleFactor  (absent) — 1x and 2x are different baselines' +
        '\n  fonts              (absent) — a substituted font compares unchanged,' +
        '\n  platform           (absent)   which is true and worthless' +
        '\n  the document       (absent) — so no cheap tier, and no ordering' +
        '\n' +
        '\n  consequence        `incomparable` is not available for an imported subject,' +
        '\n                     and its regions can only be ranked by area.' +
        '\n                     Import to get moving; let the imported generation age' +
        '\n                     out as subjects are re-recorded under an identity.\n',
    );
  });
});
