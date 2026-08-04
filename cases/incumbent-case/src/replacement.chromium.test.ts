import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspect, type SemanticSnapshot } from '@variance-authority/core';
// @ts-expect-error — a plain .mjs script, deliberately not part of the TS build.
import { stale } from '../scripts/bundle.mjs';
import { createHarness, type Harness } from '@variance-authority/playwright';
import { readIncumbent, type IncumbentResult } from './incumbent-report.js';
import { runOurArm, type Finding } from './replacement-arm.js';
import { CONFIGURATIONS, SCENARIOS, mark } from './scenarios.js';

/**
 * The head-to-head: eight edits, two arms, one page.
 *
 * The incumbent arm is not modelled here. It ran in its own process, under its
 * own runner, with its own comparator and thresholds — `scripts/incumbent.mjs`
 * — and what this file reads is the report that run wrote. A comparison against
 * our reimplementation of a competitor measures our reimplementation, which is
 * the same objection `cases/storybook-case` raises about fixtures: the only
 * arrangement in which we can be wrong is the one where the other side is real.
 *
 * Our arm takes the **same screenshot of the same clip on the same page**, and
 * then keeps reading. That is the honest framing of what is being replaced and
 * it is also the migration path: a team keeps its runner, its navigation and its
 * `page.screenshot()`, and swaps what happens afterwards. Nothing here asks
 * anybody to stop using Playwright — this repository uses Playwright.
 *
 * What separates the arms is one property of the comparison. A count is a
 * terminal value: 36 differing pixels cannot be assigned to a component, so the
 * only available response is to open the image and look. A mask is not terminal;
 * it clusters into regions, the regions join the box tree, the tree knows which
 * component produced each node, and the component resolves to a file. And below
 * the pixels there is a tier that answers three of these eight scenarios without
 * a screenshot at all, because nothing they changed was ever visible.
 *
 * Neither arm is driven from this file. Theirs is read off disk by
 * `incumbent-report.ts`, ours is run by `replacement-arm.ts`, and what is left
 * here is the only thing a head-to-head is entitled to assert: what each of them
 * hands a reviewer, against expectations `scenarios.ts` fixed before either ran.
 *
 * Run:
 *   yarn workspace @variance-authority/case-incumbent incumbent
 *   yarn vitest run cases/incumbent-case/src/replacement.chromium.test.ts
 */

const PACKAGE_ROOT = join(process.cwd(), 'cases', 'incumbent-case');
const PAGE_URL = pathToFileURL(join(PACKAGE_ROOT, 'page', 'case.html')).href;
const BUNDLE = join(PACKAGE_ROOT, 'dist', 'case.js');
const RESULTS = join(PACKAGE_ROOT, 'incumbent', 'results.json');

/** Matches `playwright.config.ts`. Both arms must observe one geometry. */
const VIEWPORT = { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' } as const;
const CLIP = '#subject';

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

/**
 * A bundle older than what it was built from is not a case that can run.
 *
 * Refusing rather than rebuilding, because rebuilding here would give our arm a
 * newer page than the one the incumbent recorded its baselines against — and a
 * head-to-head between two builds measures the builds. So the case stops and
 * names the command, which is the same rule every other prerequisite follows.
 */
const STALE = stale();

const READY = BROWSER_AVAILABLE && existsSync(BUNDLE) && existsSync(RESULTS) && STALE === null;

let harness: Harness | undefined;
let incumbent: ReadonlyMap<string, IncumbentResult> = new Map();

/**
 * Our arm, as `replacement-arm.ts` handed it back.
 *
 * Filled once, in `beforeAll`, and read by every group below — because the run
 * is a single pass over the corpus in one browser. Per-group runs would let two
 * groups disagree about the same scenario and leave nothing to say which pass
 * was right.
 */
let OURS: ReadonlyMap<string, Finding> = new Map();
let AFTER: ReadonlyMap<string, SemanticSnapshot> = new Map();
let BEFORE: ReadonlyMap<string, SemanticSnapshot> = new Map();

beforeAll(async () => {
  if (!READY) return;

  incumbent = readIncumbent(RESULTS);

  // The bundle is *read*, never rebuilt. The incumbent ran against these exact
  // bytes; rebuilding would let the two arms observe two builds and turn any
  // disagreement into a story about which of them was running yesterday's page.
  harness = await createHarness({
    url: PAGE_URL,
    bundle: readFileSync(BUNDLE, 'utf8'),
    viewport: VIEWPORT,
    fonts: ['ui-sans-serif/400/normal/incumbent-case'],
  });

  const run = await runOurArm(harness, {
    packageRoot: PACKAGE_ROOT,
    clip: CLIP,
    scale: VIEWPORT.deviceScaleFactor,
  });
  OURS = run.findings;
  AFTER = run.after;
  BEFORE = run.before;
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

const live = READY ? describe : describe.skip;

if (!READY) {
  // Loud, and with the command attached: a silently skipped head-to-head reads
  // in a summary exactly like one that ran and agreed.
  console.warn(
    '\ncases/incumbent-case: skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(BUNDLE) ? '' : '\n  no page bundle') +
      (existsSync(RESULTS) ? '' : '\n  the incumbent has not run') +
      (STALE === null ? '' : `\n  ${STALE}`) +
      '\n  yarn workspace @variance-authority/case-incumbent incumbent\n',
  );
}

live('what the incumbent tells a reviewer', () => {
  it.each(
    CONFIGURATIONS.flatMap((configuration) =>
      SCENARIOS.map((scenario) => [`${configuration.id}/${scenario.id}`, configuration.id, scenario] as const),
    ),
  )('%s', (key, configuration, scenario) => {
    const result = incumbent.get(key);
    expect(result, `${key} is missing from the incumbent report`).toBeDefined();

    // Their outcome against what was declared before either arm ran. A failure
    // here is a finding about the corpus or about them, never a scoreboard to
    // be adjusted afterwards.
    expect({ told: result!.told, handed: result!.handed }).toEqual({
      told: scenario.expect[configuration].told,
      handed: scenario.expect[configuration].handed,
    });
  });
});

live('what we tell a reviewer', () => {
  it.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))('%s', (id, scenario) => {
    const finding = OURS.get(id);
    expect(finding, `${id} was not observed`).toBeDefined();

    expect({ told: finding!.told, handed: finding!.handed }).toEqual({
      told: scenario.expect.ours.told,
      handed: scenario.expect.ours.handed,
    });
  });

  it.each(SCENARIOS.filter((scenario) => scenario.expect.names !== null).map((s) => [s.id, s] as const))(
    '%s names the component that changed',
    (id, scenario) => {
      // The column replacement turns on. Both arms can say *something changed*;
      // a finding nobody can assign is a finding nobody acts on.
      expect(OURS.get(id)!.names).toContain(scenario.expect.names);
    },
  );
});

live('the category no threshold reaches', () => {
  const invisible = ['label-dropped', 'heading-demoted', 'control-devolved'];

  it('is missed by the incumbent at every configuration it has', () => {
    // Not a tuning problem, which is the entire point of this group. There is no
    // threshold, no comparator and no tolerance that finds a change which never
    // reached a pixel — the evidence is absent from the representation.
    const missed = CONFIGURATIONS.flatMap((configuration) =>
      invisible.map((id) => `${configuration.id}/${id}: ${incumbent.get(`${configuration.id}/${id}`)!.told}`),
    );

    expect(missed).toEqual([
      'strict/label-dropped: silent',
      'strict/heading-demoted: silent',
      'strict/control-devolved: silent',
      'tolerant/label-dropped: silent',
      'tolerant/heading-demoted: silent',
      'tolerant/control-devolved: silent',
    ]);
  });

  it('is answered by us without a screenshot being needed', () => {
    // `semanticOnly` is the honest form of the economic claim: not "we are
    // faster", but "no image was consulted, because nothing these edits changed
    // was ever visible".
    for (const id of invisible) {
      const finding = OURS.get(id)!;
      expect({ id, told: finding.told, pixels: finding.pixels, semanticOnly: finding.semanticOnly }).toEqual({
        id,
        told: 'told',
        pixels: 0,
        semanticOnly: true,
      });
    }
  });
});

live('the tolerance that suppresses the flake suppresses the regression', () => {
  it('measures the budget against the thing it hides', () => {
    const strict = incumbent.get('strict/indicator-dropped')!;
    const tolerant = incumbent.get('tolerant/indicator-dropped')!;

    // The arithmetic, on this run's real numbers rather than on a hypothetical.
    // `maxDiffPixelRatio` is a fraction of the *image*, and a regression is a
    // fraction of a *component* — so the two are compared on scales that have
    // nothing to do with each other, and the smaller the affordance the safer it
    // is from being noticed.
    expect(strict.told).toBe('told');
    expect(tolerant.told).toBe('silent');
    expect(strict.pixels).not.toBeNull();

    const ratio = CONFIGURATIONS.find((c) => c.id === 'tolerant')!.maxDiffPixelRatio!;
    const budget = Math.floor(420 * 312 * ratio);

    expect(strict.pixels!).toBeLessThan(budget);
    console.log(
      `\n--- the budget and the regression` +
        `\n  tolerance          maxDiffPixelRatio ${ratio} of 420×312 = ${budget}px` +
        `\n  the indicator      ${strict.pixels}px` +
        `\n  headroom           ${Math.round(budget / strict.pixels!)}× — the regression fits ` +
        `${Math.round(budget / strict.pixels!)} times inside the tolerance`,
    );
  });
});

live('the row where we lose', () => {
  it('reports a change to the note that the camera correctly does not', () => {
    // A comparison that only ever finds in its own favour is an advertisement.
    // Leading and trailing whitespace inside a block collapses away when it is
    // painted; telling a block context from an inline one needs a layout engine,
    // and the normalizer does not consult one. So this is a false alarm, it is
    // ours, and it is asserted so that the day somebody fixes it this test goes
    // red and says so.
    expect(incumbent.get('strict/note-reindented')!.told).toBe('silent');
    expect(incumbent.get('tolerant/note-reindented')!.told).toBe('silent');

    const ours = OURS.get('note-reindented')!;
    expect(ours.told).toBe('told');
    expect(ours.pixels).toBe(0);
    expect(mark(false, ours.told)).toBe('false alarm');
  });
});

live('the scoreboard', () => {
  it('prints it', () => {
    const rows = SCENARIOS.map((scenario) => {
      const strict = incumbent.get(`strict/${scenario.id}`)!;
      const tolerant = incumbent.get(`tolerant/${scenario.id}`)!;
      const ours = OURS.get(scenario.id)!;

      return {
        id: scenario.id,
        truth: scenario.regression ? 'regression' : 'no defect',
        strict: mark(scenario.regression, strict.told),
        tolerant: mark(scenario.regression, tolerant.told),
        ours: mark(scenario.regression, ours.told),
        handed: ours.names.length > 0 ? ours.names.slice(0, 2).join(', ') : ours.handed,
      };
    });

    const width = (pick: (row: (typeof rows)[number]) => string): number =>
      Math.max(...rows.map((row) => pick(row).length));

    const columns = [
      { head: 'scenario', pick: (row: (typeof rows)[number]) => row.id },
      { head: 'ground truth', pick: (row: (typeof rows)[number]) => row.truth },
      { head: 'incumbent (defaults)', pick: (row: (typeof rows)[number]) => row.strict },
      { head: 'incumbent (tolerant)', pick: (row: (typeof rows)[number]) => row.tolerant },
      { head: 'ours', pick: (row: (typeof rows)[number]) => row.ours },
      { head: 'and we name', pick: (row: (typeof rows)[number]) => row.handed },
    ];

    const sizes = columns.map((column) => Math.max(column.head.length, width(column.pick)));
    const line = (cells: readonly string[]): string =>
      cells.map((cell, index) => cell.padEnd(sizes[index]!)).join('  ');

    const tally = (pick: (row: (typeof rows)[number]) => string): string => {
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(pick(row), (counts.get(pick(row)) ?? 0) + 1);
      return [...counts].sort().map(([name, count]) => `${count} ${name}`).join(', ');
    };

    console.log(
      [
        '',
        '--- eight edits, two arms',
        line(columns.map((column) => column.head)),
        line(sizes.map((size) => '-'.repeat(size))),
        ...rows.map((row) => line(columns.map((column) => column.pick(row)))),
        '',
        `  incumbent (defaults)  ${tally((row) => row.strict)}`,
        `  incumbent (tolerant)  ${tally((row) => row.tolerant)}`,
        `  ours                  ${tally((row) => row.ours)}`,
        '',
      ].join('\n'),
    );

    // Detection is not the claim. The claim is that a reviewer is handed
    // something they can act on, so the files are printed too.
    const named = SCENARIOS.map((scenario) => OURS.get(scenario.id)!)
      .flatMap((finding) => finding.files)
      .filter((line, index, all) => all.indexOf(line) === index);

    console.log(['--- and what an editor can open', ...named.map((entry) => `  ${entry}`), ''].join('\n'));

    expect(named.length).toBeGreaterThan(0);
  });
});

/**
 * The arm that needs no baseline, and where it stops.
 *
 * Both incumbent configurations are silent on all three of the a11y scenarios,
 * and ours catches all three — by comparing two documents. That still leaves the
 * case a comparison cannot reach: the control that *never* had a label. There is
 * no "before" in which it worked, so there is nothing to compare against, and
 * approving the first baseline approves the defect.
 *
 * `inspect` reads the post-edit render alone. One of the three falls out of it,
 * and two do not — which is the honest shape of the claim. Inspection and
 * comparison catch different things and neither contains the other:
 *
 * - a control with no accessible name is a property of the render, so one
 *   snapshot decides it;
 * - a heading demoted to a `<div>` and a `<button>` devolved to a `<div>` are
 *   only defects *relative to what they were*. A `<div>` is not wrong. Nothing
 *   in the broken render says the styling was copied off a control, which is
 *   exactly why reviews miss them, and only the baseline knows.
 */
describe.skipIf(!READY)('what one render says with no baseline', () => {
  it('reports the dropped label from the broken render alone', () => {
    const findings = inspect(AFTER.get('label-dropped')!);

    expect(findings.map((finding) => finding.rule)).toContain('control-without-name');

    const found = findings.find((finding) => finding.rule === 'control-without-name')!;
    expect(found.band).toBe('a11y');
    expect(found.what).toContain('button');
  });

  it('finds nothing in the same render before the label was dropped', () => {
    expect(inspect(BEFORE.get('label-dropped')!)).toEqual([]);
  });

  it('is silent on the two that only a baseline can decide, and that is the shape of it', () => {
    // Not a gap being excused. A `<div>` with no role is not a defect in any
    // render taken on its own — it becomes one only against the `<h2>` or the
    // `<button>` it replaced. A rule that fired here would fire on every
    // presentational element in every codebase.
    expect(inspect(AFTER.get('heading-demoted')!)).toEqual([]);
    expect(inspect(AFTER.get('control-devolved')!)).toEqual([]);

    // And the comparison arm did catch both, at `pixels: 0`.
    for (const id of ['heading-demoted', 'control-devolved']) {
      const ours = OURS.get(id)!;
      expect(ours.told, id).toBe('told');
      expect(ours.semanticOnly, id).toBe(true);
    }
  });

  it('prints what an inspection of all eight renders finds', () => {
    const rows = SCENARIOS.flatMap((scenario) =>
      inspect(AFTER.get(scenario.id)!).map((finding) => ({ scenario: scenario.id, finding })),
    );

    console.log(
      [
        '',
        '--- inspection, no baseline consulted',
        ...(rows.length === 0
          ? ['  nothing']
          : rows.map(
              ({ scenario, finding }) =>
                `  ${scenario.padEnd(20)} [${finding.rule}] ${finding.what}` +
                (finding.component !== undefined ? ` — ${finding.component}` : ''),
            )),
        '',
      ].join('\n'),
    );

    expect(rows.length).toBeGreaterThan(0);
  });
});
