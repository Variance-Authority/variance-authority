/**
 * The wrapper's one job: the two halves cannot be given different answers.
 */

import { describe, expect, it } from 'vitest';
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
