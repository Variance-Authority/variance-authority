import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * One config per build, sharing one baseline directory.
 *
 * The sharing is the point: baselines recorded from the unmodified build are
 * what the changed build is judged against, which is a branch judged against its
 * trunk and not two independent runs compared afterwards.
 */
function writeConfig(path, index) {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        project: 'storybook-case-e2e',
        profile: 'chromium',
        viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
        retention: 'durable',
        subjects: { kind: 'storybook', index, collector: COLLECTOR },
        baselines: { kind: 'directory', root: join(workspace, 'baselines') },
        fonts: ['ui-sans-serif/400/normal/sha256-case-system-stack'],
        report: join(workspace, 'run.json'),
        images: join(workspace, 'images'),
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

  writeConfig(configPath, INDEX);
  writeConfig(changedConfigPath, CHANGED_INDEX);
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
  it('reports every subject as new, and refuses to call that a pass', () => {
    const { status, out } = variance('run');

    // `new` is not a regression and is not a pass. Exit 1 is the honest code:
    // something is waiting for a person, and a green build here would record
    // eight baselines nobody looked at.
    expect(out).toContain('8 new');
    expect(status).toBe(1);

    // The whole reason the report carries a second list. A summary that says
    // nothing needs review because eleven subjects failed to render is worse
    // than no summary.
    expect(out).toContain('coverage: every planned subject was observed.');

    // Exactly once. It was printed twice by two formatters over one artifact,
    // and every test asserting it used `toContain`, which the first copy
    // satisfies.
    expect(out.split('coverage: every planned subject was observed.').length - 1).toBe(1);
  }, 240_000);

  it('promotes the images the run already produced, without rendering again', () => {
    const { status, out } = variance('accept', '--all');

    expect(out).toContain('accepted 8 subject(s)');
    expect(status).toBe(0);
  }, 240_000);

  it('finds its own baselines on the next run and settles without an image', () => {
    // The assertion the three fixed identity defects all failed. A baseline
    // `accept` wrote has to be the baseline the next `run` finds — under the
    // same digest, on the same machine, through the same codec — or the tool
    // reports `incomparable` forever and blames a machine difference that does
    // not exist.
    const { status, out } = variance('run');

    expect(out).toContain('8 unchanged');
    expect(out).not.toContain('incomparable');
    expect(out).toContain('nothing to review');
    expect(status).toBe(0);
  }, 240_000);

  it('reports exactly the stories that render the edited component', () => {
    // A source edit, judged against the baselines the trunk build recorded. The
    // interesting number is not that something changed — it is *which* subjects
    // did. `Button` appears in five of the eight stories, and the run has to
    // find five, not eight and not one.
    const { status, out } = varianceWith(changedConfigPath, 'run');

    expect(status).toBe(1);
    expect(out).toContain('3 unchanged, 5 changed');

    const changed = [...out.matchAll(/\[changed\] (\S+):/g)].map((match) => match[1]).sort();
    expect(changed).toEqual([
      'story:case-surface--button-primary',
      'story:case-surface--button-secondary',
      'story:case-surface--card-rebranded',
      'story:case-surface--card-with-actions',
      'story:case-surface--composed',
    ]);

    // Every one of those renders `Button`; the three that hold — Spinner, Clock
    // and AsyncPanel — do not. Stated as the inverse too, because "5 changed" is
    // also what a tool that changed its mind about three unrelated subjects
    // would print.
    for (const held of ['ticking', 'loading', 'deferred']) {
      expect(out).not.toContain(`[changed] story:case-surface--${held}`);
    }
  }, 240_000);

  it('names a component and a file, and cannot yet name the culprit', () => {
    // Two halves, and the second is a gap rather than a result.
    //
    // The chain reaches source: regions join the box tree, the tree names a
    // component, the component resolves to a file an editor opens. That works
    // here against a Storybook nobody wrote for us.
    //
    // What it cannot do on this path is say which of those components is the
    // *cause*. Ranking cause above collateral needs the previous revision's
    // snapshot, and a durable run has a baseline image without one — so every
    // region is reported `collateral` and the ordering falls back to area, which
    // journal 0013 measured as backwards. The edit is to `Button`; the largest
    // region belongs to the wrapper it displaced.
    //
    // Asserted as it stands so that the day a semantic baseline is carried, this
    // goes red and says so.
    const { out } = varianceWith(
      changedConfigPath,
      'report',
      '--subject',
      'story:case-surface--button-primary',
    );

    expect(out).toMatch(/src\/ds\.jsx:\d+/);
    expect(out).toContain('collateral');
    expect(out).not.toContain('cause ');
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
