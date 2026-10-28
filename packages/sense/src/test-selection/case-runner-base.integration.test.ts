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
 * to itself. Where the line ships `@vitest/runner`, the runner is handed it by
 * path, as `runnerImports` in `vitest.ts` hands it; Vitest 5 ships neither it
 * nor `vitest/runners`. `probe` runs after the class is read, with `Runner` in
 * scope, and what it prints is `ran`.
 */
async function load(vitest: { readonly root: string; readonly runners?: string; readonly probe?: string }) {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-case-runner-base-'));
  const at = (path: string) => resolve(root, path);
  try {
    await mkdir(at('node_modules/vitest'), { recursive: true });
    await mkdir(at('runner'), { recursive: true });
    await writeFile(at('package.json'), '{"name":"project","type":"module"}');
    const runners = vitest.runners === undefined ? {} : { './runners': './runners.js' };
    await writeFile(
      at('node_modules/vitest/package.json'),
      JSON.stringify({ name: 'vitest', type: 'module', exports: { '.': './index.js', ...runners } }),
    );
    await writeFile(at('node_modules/vitest/index.js'), vitest.root);
    if (vitest.runners !== undefined) {
      await writeFile(at('node_modules/vitest/runners.js'), vitest.runners);
      await writeFile(at('runner/index.js'), 'export const getFn = () => undefined;\nexport const getHooks = () => undefined;\n');
      await writeFile(at('runner/utils.js'), 'export const getNames = () => [];\n');
    }
    await writeFile(
      at('case-runner.mjs'),
      caseRunnerSource(vitest.runners === undefined ? {} : { module: './runner/index.js', utils: './runner/utils.js' }),
    );
    await writeFile(at('probe.mjs'), [
      "const { default: Runner } = await import('./case-runner.mjs');",
      "console.log(Object.getPrototypeOf(Runner).name);",
      vitest.probe ?? '',
    ].join('\n'));
    const { stdout, stderr } = await execute(process.execPath, [at('probe.mjs')], { cwd: root });
    const [base, ...ran] = stdout.trim().split('\n');
    return { base, stderr, ...(vitest.probe === undefined ? {} : { ran: ran.join('\n') }) };
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

  it('is the root\'s `TestRunner` on Vitest 5, which ships no `vitest/runners` and no `@vitest/runner`', async () => {
    // Vitest 5 folded `@vitest/runner` into itself and keeps `getFn` private;
    // the class hands the test's function out as `TestRunner.getTestFn`.
    const loaded = await load({
      root: 'export class TestRunner { static getTestFn(test) { return () => "ran " + test.name; } static getSuiteHooks() { return {}; } }\n',
      probe: 'console.log(await new Runner().runTask({ name: "adds one" }));',
    });

    expect(loaded).toEqual({ base: 'TestRunner', stderr: '', ran: 'ran adds one' });
  });
});
