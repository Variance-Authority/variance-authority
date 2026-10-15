/**
 * The wrapper's one job: the two halves cannot be given different answers.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SELECTION_REPORTER, withTestSelection } from './with-test-selection.js';

describe('a configuration that records what it ran', () => {
  it('gives the workers and the fold the same values', () => {
    const wrapped = withTestSelection({}, { label: 'app', root: '/repo' });

    expect(wrapped.use).toMatchObject({ varianceExecution: { label: 'app', root: '/repo' } });
    expect(wrapped.reporter).toContainEqual([SELECTION_REPORTER, { label: 'app', root: '/repo' }]);
  });

  it('records under every project, because a project is another run of the same specs', () => {
    const wrapped = withTestSelection(
      { projects: [{ name: 'chromium' }, { name: 'webkit', use: { headless: false } }] },
      { label: 'app' },
    );

    expect(wrapped.projects).toEqual([
      { name: 'chromium', use: { varianceExecution: { label: 'app' } } },
      { name: 'webkit', use: { headless: false, varianceExecution: { label: 'app' } } },
    ]);
  });

  it('folds once, from the top, because Playwright ignores a project’s reporters', () => {
    const wrapped = withTestSelection({ projects: [{ name: 'chromium' }] });

    expect(wrapped.projects?.[0]).not.toHaveProperty('reporter');
    expect(wrapped.reporter).toHaveLength(2);
  });

  it('keeps the reporters the configuration already had, in their order', () => {
    const wrapped = withTestSelection({ reporter: [['list'], ['html', { open: 'never' }]] });

    expect(wrapped.reporter).toEqual([
      ['list'],
      ['html', { open: 'never' }],
      [SELECTION_REPORTER, {}],
    ]);
  });

  it('names the default reporter rather than replacing it', () => {
    // A `reporter` array of one entry is the whole of a run's reporting, so a
    // configuration that had none and is handed one has quietly lost its
    // output — which is the wrapper being noticed for the wrong reason.
    expect(withTestSelection({}).reporter).toEqual(['list', [SELECTION_REPORTER, {}]]);
  });

  it('takes a reporter spelled as one name', () => {
    expect(withTestSelection({ reporter: 'dot' }).reporter).toEqual([
      'dot',
      [SELECTION_REPORTER, {}],
    ]);
  });
});

describe('a configuration whose specs are cut statement by statement', () => {
  // Beside the wrapper, which is where Playwright `require`s it from.
  const PLUGIN = expect.stringMatching(/^\/.*\/cadence-babel\.cjs$/u);

  it('compiles every spec with the cadence plugin by default', () => {
    expect(withTestSelection({})['@playwright/test']).toEqual({ babelPlugins: [[PLUGIN]] });
  });

  it('keeps the plugins the configuration already had, ahead of the cut', () => {
    const wrapped = withTestSelection({ '@playwright/test': { babelPlugins: [['/repo/own.cjs', { on: true }]], other: 1 } });

    expect(wrapped['@playwright/test']).toEqual({ babelPlugins: [['/repo/own.cjs', { on: true }], [PLUGIN]], other: 1 });
  });

  it('leaves the cut it requires untranspiled, beside what the configuration already left', () => {
    // Linked into a workspace, sense resolves outside `node_modules`, and
    // Playwright's transpiler would load its ES modules as CommonJS.
    const SENSE = expect.stringMatching(/^\*\*\/.*\/sense\/dist\/\*\*$/u);

    expect(withTestSelection({}).build).toEqual({ external: [SENSE] });
    expect(withTestSelection({ build: { external: ['**/*bundle.js'], other: 1 } }).build).toEqual({
      external: ['**/*bundle.js', SENSE],
      other: 1,
    });
  });

  it('compiles the specs as they were when cadence is off', () => {
    const config = { '@playwright/test': { babelPlugins: [['/repo/own.cjs']] }, build: { external: ['**/*bundle.js'] } };

    expect(withTestSelection({}, { cadence: false })).not.toHaveProperty('@playwright/test');
    expect(withTestSelection({}, { cadence: false })).not.toHaveProperty('build');
    expect(withTestSelection(config, { cadence: false })['@playwright/test']).toBe(config['@playwright/test']);
    expect(withTestSelection(config, { cadence: false }).build).toBe(config.build);
  });
});

describe('a configuration evaluated for a shard', () => {
  const projects: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(projects.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  /** A package at `at` that installed Playwright `version`. */
  async function installing(at: string, version: string): Promise<void> {
    const installed = resolve(at, 'node_modules/@playwright/test');
    await mkdir(installed, { recursive: true });
    await writeFile(resolve(installed, 'package.json'), JSON.stringify({ name: '@playwright/test', version }));
    await writeFile(resolve(at, 'package.json'), '{}');
  }

  /**
   * Evaluate the wrapper as `playwright test <argv>` would, from a project that
   * installed Playwright `version`, and whose `app` package installed `app`'s.
   */
  async function evaluated(version: string, argv: readonly string[], config: Record<string, unknown> = {}, app?: string) {
    const project = await mkdtemp(resolve(tmpdir(), 'variance-playwright-project-'));
    projects.push(project);
    await installing(project, version);
    if (app !== undefined) {
      await installing(resolve(project, 'app'), app);
      await writeFile(resolve(project, 'app/playwright.config.ts'), 'export default {};');
    }
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'playwright', 'test', ...argv]);
    return () => withTestSelection(config);
  }

  const refusal =
    'variance-authority: refusing shard 1/2: Playwright 1.55.0 would split it test by test, so a file could run in two shards; ' +
    'placing whole files needs Playwright 1.62 or newer';

  it('refuses a --shard the project\'s own Playwright would split test by test, before anything starts', async () => {
    expect(await evaluated('1.55.0', ['--shard', '1/2'])).toThrow(refusal);
    expect(await evaluated('1.55.0', ['--shard=1/2'])).toThrow(refusal);
  });

  it('refuses a shard the configuration sets, under the same Playwright', async () => {
    expect(await evaluated('1.55.0', [], { shard: { current: 1, total: 2 } })).toThrow(refusal);
  });

  it('runs an older Playwright that asked for no shard, and a shard Playwright can place, as before', async () => {
    expect(await evaluated('1.55.0', ['--grep', 'shard'])).not.toThrow();
    expect(await evaluated('1.62.1', ['--shard', '1/2'])).not.toThrow();
  });

  it('refuses a shard whose --reporter replaces the reporter that places it, and keeps one that names it', async () => {
    expect(await evaluated('1.62.1', ['--shard', '1/2', '--reporter=dot'])).toThrow(
      'variance-authority: refusing shard 1/2: --reporter dot replaces the configuration\'s reporters, ' +
        `so ${SELECTION_REPORTER}, which places the shard by whole files, would not run; name it in --reporter too`,
    );
    expect(await evaluated('1.62.1', ['--shard', '1/2', '--reporter', `dot,${SELECTION_REPORTER}`])).not.toThrow();
    expect(await evaluated('1.62.1', ['--reporter', 'dot'])).not.toThrow();
  });

  it('reads the Playwright the configuration\'s own package installed, not the one at the cwd', async () => {
    expect(await evaluated('1.62.1', ['-c', 'app/playwright.config.ts', '--shard', '1/2'], {}, '1.55.0')).toThrow(refusal);
    expect(await evaluated('1.62.1', ['--config=app', '--shard', '1/2'], {}, '1.55.0')).toThrow(refusal);
    expect(await evaluated('1.55.0', ['--config', 'app', '--shard', '1/2'], {}, '1.62.1')).not.toThrow();
  });

  it('keeps a --reporter that names the selection reporter by its path, as Playwright resolves it from the cwd', async () => {
    const reporter = createRequire(import.meta.url).resolve(SELECTION_REPORTER);
    expect(await evaluated('1.62.1', ['--shard', '1/2', '--reporter', `dot,${reporter}`])).not.toThrow();
    const project = await evaluated('1.62.1', []);
    const from = process.cwd();
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'playwright', 'test', '--shard', '1/2', `--reporter=./${relative(from, reporter)}`]);
    expect(project).not.toThrow();
  });
});
