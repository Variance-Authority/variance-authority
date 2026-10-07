import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { caseRunnerSource } from './worker-source.js';

const execute = promisify(execFile);

/**
 * A project whose `vitest` is shaped like one Vitest line, the case runner the
 * seam would write into it, and what Node says when that runner is imported.
 *
 * Plain Node rather than this test's own Vitest, which would resolve `vitest`
 * to itself. The `@vitest/runner` the runner imports is handed in by path, as
 * `runnerImport` in `vitest.ts` hands it.
 */
async function load(vitest: { readonly root: string; readonly runners: string }) {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-case-runner-base-'));
  const at = (path: string) => resolve(root, path);
  try {
    await mkdir(at('node_modules/vitest'), { recursive: true });
    await mkdir(at('runner'), { recursive: true });
    await writeFile(at('package.json'), '{"name":"project","type":"module"}');
    await writeFile(
      at('node_modules/vitest/package.json'),
      JSON.stringify({ name: 'vitest', type: 'module', exports: { '.': './index.js', './runners': './runners.js' } }),
    );
    await writeFile(at('node_modules/vitest/index.js'), vitest.root);
    await writeFile(at('node_modules/vitest/runners.js'), vitest.runners);
    await writeFile(at('runner/index.js'), 'export const getFn = () => undefined;\nexport const getHooks = () => undefined;\n');
    await writeFile(at('runner/utils.js'), 'export const getNames = () => [];\n');
    await writeFile(at('case-runner.mjs'), caseRunnerSource({ module: './runner/index.js', utils: './runner/utils.js' }));
    await writeFile(at('probe.mjs'), [
      "const { default: Runner } = await import('./case-runner.mjs');",
      "console.log(Object.getPrototypeOf(Runner).name);",
    ].join('\n'));
    const { stdout, stderr } = await execute(process.execPath, [at('probe.mjs')], { cwd: root });
    return { base: stdout.trim(), stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const DEPRECATED = 'console.warn("Importing from \\"vitest/runners\\" is deprecated since Vitest 4.1.");\n';

describe('the class the case runner extends', () => {
  it('is the root\'s `TestRunner` where Vitest exports one, and `vitest/runners` is never loaded', async () => {
    // Vitest 4.1 moved the class to the package root and prints a deprecation
    // line from `vitest/runners` in every worker that imports it: once per test
    // file of every recorded run.
    const loaded = await load({
      root: 'export class TestRunner {}\n',
      runners: `${DEPRECATED}export class VitestTestRunner {}\n`,
    });

    expect(loaded).toEqual({ base: 'TestRunner', stderr: '' });
  });

  it('is `vitest/runners`\'s `VitestTestRunner` where the root exports none', async () => {
    // Vitest 2, 3 and 4.0: the root has no runner class, and `vitest/runners`
    // prints nothing.
    const loaded = await load({
      root: 'export const vi = {};\n',
      runners: 'export class VitestTestRunner {}\n',
    });

    expect(loaded).toEqual({ base: 'VitestTestRunner', stderr: '' });
  });
});
