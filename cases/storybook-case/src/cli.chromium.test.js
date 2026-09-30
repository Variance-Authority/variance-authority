import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `variance run` as a process, against a Storybook this project did not author.
 *
 * Everything else that exercises the CLI injects a fake `Collector` and a fake
 * `Renderer`, which is the right way to test the loop and cannot test the
 * *workflow*: whether a run leaves behind something `accept` can promote, whether
 * a promoted baseline is the one the next run finds, and whether the exit codes
 * a CI job reads mean what they claim over a whole cycle.
 *
 * That gap was not academic. The first execution of this file's three commands
 * found five defects nothing in `packages/cli/src/commands/run.test.ts` could
 * have found, and three of them made the durable workflow unusable rather than
 * merely wrong:
 *
 * 1. **The run never exited.** `deps.renderer()` is a factory and nothing closed
 *    what it opened, so a correct report was printed and the process sat there
 *    holding a browser. A fake renderer costs nothing to leave open.
 * 2. **`stabilization` was dropped by the identity wire codec**, so `accept`
 *    stored a baseline under a shorter digest than the next `run` looked it up
 *    with. Every subject came back `incomparable`, forever, on one machine.
 * 3. **The refusal named the same machine on both sides**, because
 *    `describeIdentity` printed neither the fonts nor the recipe — the two
 *    fields the digest covers and the sentence omitted. Which is how (2) managed
 *    to be invisible.
 * 4. The coverage section was printed twice, by the CLI and by the MCP tool it
 *    delegates to.
 * 5. A production Storybook build minifies, so component attribution reported
 *    `in a` — a complete, confident answer naming something that is in no source
 *    file. See `.storybook/main.js`.
 *
 * So this asserts the cycle, not the loop: **new → accept → unchanged**, with the
 * exit codes CI reads at each step.
 *
 * Fully hermetic. The config is written into a temporary directory with absolute
 * paths, so baselines and reports never land in the working tree and two runs of
 * the suite cannot see each other's.
 *
 * Skipped, loudly, when the Storybook is not built, the CLI is not compiled, or
 * there is no browser.
 */

const ROOT = join(process.cwd(), 'cases', 'storybook-case');
const BIN = join(process.cwd(), 'packages', 'cli', 'dist', 'bin.js');
const INDEX = join(ROOT, 'storybook-static', 'index.json');
/** The same project, built with `VITE_CASE_MUTATION=wide-button`. */
const CHANGED_INDEX = join(ROOT, 'storybook-changed', 'index.json');
const COLLECTOR = join(ROOT, 'collector', 'index.mjs');

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const READY =
  existsSync(INDEX) && existsSync(CHANGED_INDEX) && existsSync(BIN) && BROWSER_AVAILABLE;

let workspace = '';
let configPath = '';
let changedConfigPath = '';
/** The ticking story's own directory: its config, its baseline and its report. */
let tickingHome = '';
let tickingConfigPath = '';

/**
 * One config per build, sharing one baseline directory, and a third config with
 * a directory of its own for the ticking story.
 *
 * The sharing is the point: baselines recorded from the unmodified build are
 * what the changed build is judged against, which is a branch judged against its
 * trunk and not two independent runs compared afterwards.
 *
 * `no-variance` matches the case's own `variance.config.json`, and is not a
 * convenience for this file: `Sheet — left in the document` appends a rule to
 * the page and never removes it, so a run that planned it would read every
 * subject after it through that rule and the workflow below would be measuring
 * story order rather than an edit. It is a cause the case runs — in
 * `alone.chromium.test.js` — and never a subject.
 *
 * `unstable` is the cycle's own exclusion. One reading of `Clock — ticking`
 * agrees with its baseline only when both land in the same 50 ms step, so the
 * cycle, which asserts `unchanged`, leaves it to the sweep below.
 */
function writeConfig(path, index, excludeTags, home) {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        project: 'storybook-case-e2e',
        profile: 'chromium',
        viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
        retention: 'durable',
        subjects: { kind: 'storybook', index, collector: COLLECTOR, excludeTags },
        baselines: { kind: 'directory', root: join(home, 'baselines') },
        fonts: ['ui-sans-serif/400/normal/sha256-case-system-stack'],
        report: join(home, 'run.json'),
        images: join(home, 'images'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

beforeAll(() => {
  if (!READY) return;

  workspace = mkdtempSync(join(tmpdir(), 'variance-case-'));
  configPath = join(workspace, 'variance.config.json');
  changedConfigPath = join(workspace, 'variance.changed.json');
  tickingHome = join(workspace, 'ticking');
  tickingConfigPath = join(tickingHome, 'variance.config.json');

  mkdirSync(tickingHome);
  writeConfig(configPath, INDEX, ['no-variance', 'unstable'], workspace);
  writeConfig(changedConfigPath, CHANGED_INDEX, ['no-variance', 'unstable'], workspace);
  writeConfig(tickingConfigPath, INDEX, ['no-variance'], tickingHome);
});

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

function variance(...args) {
  return varianceWith(configPath, ...args);
}

function varianceWith(config, ...args) {
  const result = spawnSync(process.execPath, [BIN, ...args, '--config', config], {
    cwd: process.cwd(),
    encoding: 'utf8',
    // Generous, and finite. A hang here is the first defect above coming back,
    // and a suite that waits forever for it reports nothing at all.
    timeout: 180_000,
  });

  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const live = READY ? describe : describe.skip;

if (!READY) {
  console.warn(
    '\ncases/storybook-case (cli): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(BIN) ? '' : '\n  the CLI is not built — yarn build') +
      (existsSync(INDEX)
        ? ''
        : '\n  no Storybook — yarn workspace @variance-authority/case-storybook build-storybook') +
      (existsSync(CHANGED_INDEX)
        ? ''
        : '\n  no changed build — yarn workspace @variance-authority/case-storybook build-storybook:changed') +
      '\n',
  );
}

live('the durable workflow, end to end', () => {
  it('reports every subject as new, and neither fails nor accepts it', () => {
    const { status, out } = variance('run');

    // `new` is not a regression and is not a pass. Nothing moved, so the exit
    // is 0; nothing was accepted either, so the next run reports the same
    // thirteen subjects `new` until a person accepts them.
    expect(out).toContain('13 new');
    expect(status).toBe(0);

    // The whole reason the report carries a second list. A summary that says
    // nothing needs review because eleven subjects failed to render is worse
    // than no summary.
    //
    // The list is not empty here, and that is the branch worth running end to
    // end: three of the sixteen stories are held out by tag and one by its own
    // parameters, and one story is read at two widths, so the header says
    // thirteen of seventeen, the second list separates a subject nobody could
    // render from a subject nobody asked for, and it names what held each out.
    // The empty branch is asserted over a hand-built report in
    // `packages/cli/src/commands/report.test.ts`; this one had no exercise
    // anywhere until a real run had something real to leave out.
    //
    // Two are held out by `no-variance`, for the same reason and not the same
    // subject matter: `LeaksASheet` is a cause rather than a subject, and
    // `FinishesLate` is a subject about the driver — it exists so
    // `src/finish.chromium.test.js` has a story that is still in `afterEach`
    // when the next one is asked for. Neither is a component anybody would want
    // a baseline of. The third is `Clock — ticking`, held out by `unstable`
    // because this cycle asserts `unchanged` and one reading of it cannot
    // promise that. See `writeConfig`.
    expect(out).toContain('13 of 17 subject(s) observed');
    expect(out).toContain('0 the run could not see, 4 excluded by configuration');
    expect(out).toContain('[excluded] story:case-surface--leaks-a-sheet: excluded by tag `no-variance`');
    expect(out).toContain('[excluded] story:case-surface--finishes-late: excluded by tag `no-variance`');
    expect(out).toContain('[excluded] story:case-surface--ticking: excluded by tag `unstable`');
    expect(out).toContain(
      '[excluded] story:case-surface--receipt-not-read: excluded by its own parameters (`variance.exclude`)',
    );

    // Exactly once. It was printed twice by two formatters over one artifact,
    // and every test asserting it used `toContain`, which the first copy
    // satisfies.
    expect(out.split('not observed: 4 subject(s)').length - 1).toBe(1);
  }, 240_000);

  it('reads a story at the widths its own parameters declare', () => {
    // The index carries no parameters, so this is the collector asking the
    // running preview. Two subjects is the plan agreeing with the story; two
    // widths of paint is the page having been resized for each. `Card — receipt
    // at two widths` is laid out padded, so its box is the width less
    // Storybook's 1rem either side.
    const report = JSON.parse(readFileSync(join(workspace, 'run.json'), 'utf8'));
    const painted = (width) => {
      const subject = `story:case-surface--receipt-at-two-widths@${width}`;
      const observation = report.observations.find((entry) => entry.subject === subject);
      expect(observation?.verdict, subject).toBe('new');
      return JSON.parse(readFileSync(join(workspace, observation.images.record), 'utf8')).width;
    };

    expect(report.observations.map((entry) => entry.subject)).not.toContain(
      'story:case-surface--receipt-at-two-widths',
    );
    expect(painted(375)).toBe(375 - 32);
    expect(painted(800)).toBe(800 - 32);
  }, 240_000);

  it('promotes the images the run already produced, without rendering again', () => {
    const { status, out } = variance('accept', '--all');

    expect(out).toContain('accepted 13 subject(s)');
    expect(status).toBe(0);
  }, 240_000);

  it('finds its own baselines on the next run and settles without an image', () => {
    // The assertion the three fixed identity defects all failed. A baseline
    // `accept` wrote has to be the baseline the next `run` finds — under the
    // same digest, on the same machine, through the same codec — or the tool
    // reports `incomparable` forever and blames a machine difference that does
    // not exist.
    const { status, out } = variance('run');

    expect(out).toContain('13 unchanged');
    expect(out).not.toContain('incomparable');
    expect(out).toContain('nothing to review');
    expect(status).toBe(0);
  }, 240_000);

  it('diagnoses a ticking story as unstable and refuses to accept its coin-flip candidate', () => {
    // Its own config and baseline. A `new` subject is read once, so this run and
    // its `accept` record a baseline with no second reading to disagree with.
    const subject = 'story:case-surface--ticking';
    const recorded = varianceWith(tickingConfigPath, 'run', '--subjects', subject);
    expect(recorded.out).toContain('1 new');
    expect(recorded.status).toBe(0);
    const baseline = varianceWith(tickingConfigPath, 'accept', subject);
    expect(baseline.out).toContain('accepted 1 subject(s)');
    expect(baseline.status).toBe(0);

    // The sweep reads the subject twice and asks whether the readings agree.
    // Whether one of them matches the baseline depends on which 50 ms step it
    // lands in, so the verdict is `unchanged` or `changed` and is not the claim.
    const { status, out } = varianceWith(tickingConfigPath, 'run', '--flakes', '--subjects', subject);

    expect(status).toBe(1);
    expect(out).toContain(`[unstable] ${subject}`);

    const report = JSON.parse(readFileSync(join(tickingHome, 'run.json'), 'utf8'));
    const observation = report.observations.find((entry) => entry.subject === subject);

    expect(['unchanged', 'changed']).toContain(observation?.verdict);
    // A continuously changing story can yield either of the two valid
    // non-repeatability readings: two completed collections that disagree, which
    // name the component that wrote the text, or one completed collection
    // followed by a collection that never settles.
    expect(observation?.unstable?.because).toMatch(/differ: Clock src\/ds\.jsx:\d+|cannot be taken twice/);

    const refused = varianceWith(tickingConfigPath, 'accept', subject);
    // `accept` has no safe action to take, so refusal is an operator outcome
    // rather than a second review verdict. The important part is that no
    // baseline can be promoted from either reading of the ticking story.
    expect(refused.status).toBe(2);
    expect(refused.out).toContain('accepted 0 subject(s), refused 1');
    expect(refused.out).toContain('Accepting it would promote one of two readings');
  }, 240_000);

  it('reports exactly the stories that render the edited component', () => {
    // A source edit, judged against the baselines the trunk build recorded. The
    // interesting number is not that something changed — it is *which* subjects
    // did. `Button` appears in five of the thirteen subjects, and the run has to
    // find five, not thirteen and not one.
    const { status, out } = varianceWith(changedConfigPath, 'run');

    expect(status).toBe(1);
    expect(out).toContain('8 unchanged, 5 changed');

    // Anchored on the id rather than on what follows it. The summary now names
    // the causing component after the subject, so a pattern that leaned on the
    // next colon started capturing `story`.
    const changed = [...out.matchAll(/\[changed\] (story:[\w-]+)/g)].map((m) => m[1]).sort();
    expect(changed).toEqual([
      'story:case-surface--button-primary',
      'story:case-surface--button-secondary',
      'story:case-surface--card-rebranded',
      'story:case-surface--card-with-actions',
      'story:case-surface--composed',
    ]);

    // Every one of those renders `Button`; the eight that hold — Spinner,
    // AsyncPanel, the disclosure a play function opens, the three Suspense
    // stories and the receipt at both its widths — do not. All eight read the
    // same way twice, so each one holding is a claim about this edit and not
    // about when it was read; `Clock — ticking` is not in this run for that
    // reason. Stated as the inverse too, because "5 changed" is also what a tool
    // that changed its mind about three unrelated subjects would print.
    //
    // The Suspense three carry a second claim by being in this list at all: a
    // subject captured mid-arrival is not stable across two builds, so
    // `suspense-settles` and `suspense-waterfall` holding still is the wait
    // working, and `suspense-stalled` holding still is a declared loading
    // capture behaving like any other baseline.
    for (const held of [
      'loading',
      'deferred',
      'suspense-settles',
      'suspense-waterfall',
      'suspense-stalled',
    ]) {
      expect(out).not.toContain(`[changed] story:case-surface--${held}`);
    }

    // Every changed subject is read a second time before its verdict is trusted,
    // and none of these disagreed with itself. That is an assertion about *this
    // tool*, not about the Storybook: the second reading found all five unstable
    // when it was first run here, because Blink materializes a mutated inline
    // style into the `style` attribute lazily and `outerHTML` therefore appended
    // it after our own stamp on a fresh mount and before it on a re-read. Same
    // tree, same pixels, two document digests — and a document digest is what
    // `settle` compares to skip a render, so the whole cheap tier was quietly
    // switching itself off depending on whether a subject had been read before.
    // See `materializeAttributes` in `packages/dom/src/document.ts`.
    expect(out).not.toContain('UNSTABLE');
  }, 240_000);

  it('names a component and a file, and cannot yet name the culprit', () => {
    // Two halves, and the second is a gap rather than a result.
    //
    // The chain reaches source: regions join the box tree, the tree names a
    // component, the component resolves to a file an editor opens. That works
    // here against a Storybook nobody wrote for us.
    //
    // And it names the *cause*. It could not until 2026-08-06, and two separate
    // things had to be true. A baseline carries the component hashes of the
    // document that painted it (ADR-0027), so the run knows `Button`'s own
    // content moved and `Tokens`'s did not. And the geometric join stopped
    // breaking a tie towards the outer box: `Tokens` wraps `Button` and measures
    // `454.34,359 115.33×50` — byte-identical to it — so neither is tighter and
    // the walk decided, in document order, which is always the wrapper first.
    //
    // The edit is to `Button`. The report says `Button`, at `Button`'s file.
    const { out } = varianceWith(
      changedConfigPath,
      'report',
      '--subject',
      'story:case-surface--button-primary',
    );

    expect(out).toMatch(/src\/ds\.jsx:\d+/);
    expect(out).toContain('cause ');
    expect(out).toContain('Button');
    // No region blames the wrapper. `Tokens` is still named as collateral among
    // the components, because its box grew with `Button`'s — which is true, and
    // is not the region's claim.
    expect(out).not.toMatch(/collateral +\d+px/);
    expect(out).toMatch(/cause +Button — geometry, token/);
    // And the declaration the `wide-button` build changed, with both values.
    expect(out).toMatch(/padding-left \S+ → \S+/);

    // And the line is the element's, not the component's.
    //
    // Two mechanisms can answer "which file", and only one of them can answer
    // "which of the four buttons on this page". Resolving the name `Button`
    // against a scan of the repository lands on the line `Button` is *declared*
    // on, which is the same line for every instance ever rendered. The fiber
    // carries the location the transform computed for the element itself, put
    // there by `jsxImportSource: '@variance-authority/jsx-source'` in
    // `.storybook/main.js` and read back off `memoizedProps`.
    //
    // Derived rather than hard-coded, because the interesting claim is *which of
    // the two lines* the report chose, and a literal would go stale silently the
    // first time somebody adds an import to `ds.jsx`.
    const ds = readFileSync(join(ROOT, 'src', 'ds.jsx'), 'utf8').split('\n');
    const declared = ds.findIndex((line) => line.startsWith('export function Button')) + 1;
    const written = ds.findIndex((line) => line.trimStart().startsWith('<button')) + 1;

    expect(declared).toBeGreaterThan(0);
    expect(written).toBeGreaterThan(declared);
    expect(out).toContain(`src/ds.jsx:${written}`);
    expect(out).not.toContain(`src/ds.jsx:${declared}`);

    // And the image is of the page it was acquired from. It was not until
    // 2026-08-06: Storybook's preview centres its story with a rule on `body`,
    // `applicableCss` walked only the subject and its descendants, so the rule
    // never reached the render and the subject was painted full-width. The
    // reported size was `1024×76 to 1024×82` against an acquired subject 147.33
    // CSS pixels wide — every coordinate converted between two layouts.
    //
    // `subject-size-diverged` was the detector, and its silence is the assertion:
    // a warning that never fires is indistinguishable from one that cannot, so
    // the size is checked directly too.
    expect(out).not.toContain('subject-size-diverged');
    expect(out).toMatch(/resized from 1\d\d×\d+ to 1\d\d×\d+/);
  }, 240_000);

  /**
   * The half that needs no baseline at all, run against a Storybook nobody wrote
   * for us.
   *
   * Whatever it finds here is the finding — including nothing. What is asserted
   * is the property that makes the number readable either way: every observation
   * carries a findings list, so an empty run means *inspected and clean* rather
   * than *nobody looked*. A report where the two are indistinguishable can
   * report a clean bill of health from a collector that supplied no snapshot.
   */
  it('inspects every render, and says so whether or not it finds anything', () => {
    const report = JSON.parse(readFileSync(join(workspace, 'run.json'), 'utf8'));

    expect(report.observations.length).toBeGreaterThan(0);
    for (const observation of report.observations) {
      expect(Array.isArray(observation.findings), observation.subject).toBe(true);
    }

    const findings = report.observations.flatMap((observation) => observation.findings);
    console.log(
      `\n  INSPECTION — ${findings.length} finding(s) across ${report.observations.length} subjects` +
        findings.map((f) => `\n    [${f.rule}] ${f.what}  ${f.file ?? ''}`).join(''),
    );

    // Each one must be actionable on its own: a rule nobody can locate is a rule
    // nobody fixes.
    for (const finding of findings) {
      expect(finding.what.length, finding.rule).toBeGreaterThan(0);
      expect(finding.path, finding.rule).toBeTypeOf('string');
    }
  }, 240_000);
});

// Top level on purpose. `live` is `describe.skip` on a machine without a browser
// or a build, and a todo inside a skipped block is reported as *skipped* — the
// count these belong in disappears exactly where the suite is least covered.

it.todo(
  'eleven `run` / `accept --all` cycles over twelve builds of this case, each raising `--case-space` in `src/ds.jsx` by 2px, end with a `DRIFT:` line reporting 22px of travel on that token and one commit per step — needs a distinct `--run` and `--commit` per cycle and this case pointed at a running `@variance-authority/server`, and `Card — rebranded token` stays put throughout, because it overrides the token inline',
);

it.todo(
  '`Stack`, displaced in every one of those twelve builds and edited in none of them, reports zero churn and eleven collateral runs against the rows the runs themselves wrote — spec 0002 acceptance 2, needs this case pointed at a running `@variance-authority/server`',
);

it.todo(
  'a `run` over an unmodified build records a quiet run, so `Button`’s churn over the window divides by every run recorded rather than only by the runs it moved in — spec 0002 acceptance 3, needs this case pointed at a running `@variance-authority/server`',
);

it.todo(
  'the trunk build and the `wide-button` build each record their own hash for `Button` under one `(subject, component, band)` key, both rows survive every later query, and neither the write nor the read resolves a merge — spec 0002 acceptance 5, needs both configs pointed at one running `@variance-authority/server`',
);

it.todo(
  'the same new → accept → unchanged → changed cycle reaches the same verdicts over a component library this project did not write — needs a third-party library vendored as a case, with the edit and the subjects it should move declared before the run (spec 0022)',
);

it.todo(
  'a story whose image changes behind an unchanged URL is reported as changed, because the wire hashed the response body — the route path proves this in `packages/route-collector/src/network.chromium.test.ts` and the Storybook path runs the same page agent and the same per-story narrowing, so nothing here needs building — needs a served Storybook fixture whose asset bytes can be swapped between two runs at one URL, which this case has no origin to do',
);

it.todo(
  'the same story, captured as an in-place raster from the preview page the runner already painted, reaches the same verdict as the document this case renders later — ADR-0044 calls this cell coherent because the preview is a painted page, and nothing builds it: the collector needs an in-place material option and the host launch recipe declared the way `@variance-authority/playwright-test` declares it',
);

it.todo(
  'a `run` whose plan reads `Sheet — left in the document` before `Card — with actions` reports that card `order-dependent` rather than `changed`, and `accept` refuses it — `alone.chromium.test.js` proves the two readings the collector answers with and `packages/cli/src/commands/alone.test.ts` proves the verdict over a fake, so the missing piece is the join: needs a way to declare or permute subject order in a run, because the plan is in index order and the leaking story is last in it',
);
