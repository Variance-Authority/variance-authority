import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createContext, runInContext } from 'node:vm';
import { rspack } from '@rspack/core';
import { afterAll, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { decodeTestCoverage } from './format.js';
import { EXECUTION_GLOBAL, recordExecution, type ExecutionCollector } from './journal.js';

// A Storybook built by Rspack runs the project's loaders and no test runner:
// the probes come from the rule `testSelectionRule` writes, at
// `enforce: 'post'`. In `compilers/rspack.build.mjs`, SWC is followed by an
// extractor that reads `css()`'s arrow and fails on anything but a condition
// between two strings. The build passes, the page it ships runs, and what the
// page ran is recorded under the regions the author wrote; the virtual entry,
// which no file holds, is not among them. With `placement:
// 'before-transforms'` the rule runs first, and the extractor reads the probes.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/compilers');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('a page Rspack built, a syntax-reading compiler among its loaders', () => {
  it('builds and runs as it would unprobed, and records the regions the author wrote', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rspack-'));
    temporary.push(directory);
    // The extractor refusing the probed arrow fails the build.
    await execute(process.execPath, [resolve(fixture, 'rspack.build.mjs'), resolve(directory, 'out')], { cwd: fixture });

    const page = createContext({});
    runInContext(await readFile(resolve(directory, 'out/page.js'), 'utf8'), page);
    expect(runInContext('globalThis.pressed', page)).toBe('red');

    const collector = runInContext(`globalThis[${JSON.stringify(EXECUTION_GLOBAL)}]`, page) as ExecutionCollector;
    const journal = collector.drain();
    expect(journal.modules.map((module) => module.id.split('@')[0]).sort()).toEqual([named('src/cls.ts'), named('src/tone.ts')]);

    const coverageFile = resolve(directory, 'coverage.bin');
    await recordExecution({ root: repository, cacheRoot: directory, coverageFile, subjects: [{ owner: 'story:tone--pressed', journal }] });
    const module = decodeTestCoverage(await readFile(coverageFile)).modules.find((candidate) => candidate.file === named('src/tone.ts'));
    const story = ['story:tone--pressed'];
    expect(module?.blocks.map((block) => [block.name, block.path, block.startLine, block.endLine, block.testFiles])).toEqual([
      ['', 'module', 1, 12, story],
      ['css.arg0', 'entry', 2, 2, story],
      ['label', 'entry', 3, 6, story],
      ['label', 'if#0/then', 4, 4, story],
      ['label', 'if#0/else', 4, 4, []],
      ['label', 'if#0/after', 5, 5, []],
      ['shade', 'entry', 7, 10, []],
      ['shade', 'if#0/then', 8, 8, []],
      ['shade', 'if#0/else', 8, 8, []],
      ['shade', 'if#0/after', 9, 9, []],
    ]);
    expect(module?.sourceDigest).toBe(digestString(await readFile(resolve(fixture, 'src/tone.ts'), 'utf8')));
  }, 60_000);

  it('probes the page with the loader in Rspack\'s worker threads, `include` being the rule\'s own condition', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rspack-'));
    temporary.push(directory);
    await execute(process.execPath, [resolve(fixture, 'rspack.build.mjs'), resolve(directory, 'out')], {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_PARALLEL: '1' },
    });

    const page = createContext({});
    runInContext(await readFile(resolve(directory, 'out/page.js'), 'utf8'), page);
    const collector = runInContext(`globalThis[${JSON.stringify(EXECUTION_GLOBAL)}]`, page) as ExecutionCollector;
    expect(collector.drain().modules.map((module) => module.id.split('@')[0]).sort()).toEqual([named('src/cls.ts'), named('src/tone.ts')]);
  }, 60_000);

  it('places the probes ahead of the loaders with `placement: \'before-transforms\'`, where the extractor reads them', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rspack-'));
    temporary.push(directory);
    const failed = await execute(process.execPath, [resolve(fixture, 'rspack.build.mjs'), resolve(directory, 'out')], {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_PLACEMENT: 'before-transforms' },
    }).then(
      () => undefined,
      (error: { stdout: string; stderr: string }) => `${error.stdout}${error.stderr}`,
    );
    expect(failed).toMatch(/extractor: `[^`]*__va\([^`]*` is unable to have its styles extracted/);
  }, 60_000);
});

describe('a CommonJS module Rspack bundles', () => {
  /**
   * `lib`, opening with `prologue`, and the entry requiring it, with extension
   * `extension`, built for Node through the rule alone. A `typed` lib carries
   * an annotation the instrumenter does not read in a script, which SWC strips
   * ahead of the rule: the rule marks it as loaded rather than probing it.
   */
  async function bundled(extension: '.js' | '.cjs', prologue = '', typed = false): Promise<{ root: string; page: string }> {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-authority-cjs-')));
    temporary.push(root);
    await mkdir(resolve(root, 'src'));
    await writeFile(
      resolve(root, `src/lib${extension}`),
      `${prologue}function tone(on${typed ? ': boolean' : ''}) {\n  if (on) return "red";\n  return "blue";\n}\nmodule.exports = { tone, strict: (function () { return this === undefined; })() };\n`,
    );
    // The built rule: it names the loader by path, and Rspack loads that path as it is.
    const { testSelectionRule } = (await import(pathToFileURL(resolve(repository, 'packages/sense/dist/test-selection/probes-rule.js')).href)) as typeof import('./probes-rule.js');
    await writeFile(resolve(root, `src/main${extension}`), `const { tone, strict } = require("./lib${extension}");\nglobalThis.pressed = tone(true);\nglobalThis.strict = strict;\n`);
    const compiler = rspack({
      mode: 'development',
      devtool: 'source-map',
      target: 'node',
      context: root,
      entry: `./src/main${extension}`,
      output: { path: resolve(root, 'out'), filename: 'page.js' },
      module: {
        rules: [
          testSelectionRule({ root }),
          ...(typed ? [{ test: /lib\.c?js$/, use: [{ loader: 'builtin:swc-loader', options: { jsc: { parser: { syntax: 'typescript' } } } }] }] : []),
        ],
      },
    });
    const stats = await new Promise<{ hasErrors(): boolean; toString(options: object): string }>((done, fail) =>
      compiler.run((error, result) => (error ? fail(error) : done(result!))),
    );
    await new Promise((done) => compiler.close(done));
    if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
    return { root, page: await readFile(resolve(root, 'out/page.js'), 'utf8') };
  }

  for (const extension of ['.cjs', '.js'] as const) {
    it(`keeps a \`${extension}\` script a script, its exports read and its probes run`, async () => {
      const { page } = await bundled(extension);
      const context = createContext({});
      runInContext(page, context);
      expect(runInContext('globalThis.pressed', context)).toBe('red');
      const journal = (runInContext(`globalThis[${JSON.stringify(EXECUTION_GLOBAL)}]`, context) as ExecutionCollector).drain();
      expect(journal.modules.map((module) => module.id.split('@')[0]).sort()).toEqual([`src/lib${extension}`, `src/main${extension}`]);
    }, 60_000);
  }

  it('keeps a script that opens with "use strict" strict', async () => {
    const { page } = await bundled('.cjs', '"use strict";\n');
    const context = createContext({});
    runInContext(page, context);
    expect(runInContext('globalThis.pressed', context)).toBe('red');
    expect(runInContext('globalThis.strict', context)).toBe(true);
  }, 60_000);

  it('keeps a script it marks rather than probes a script, its exports read', async () => {
    const { page } = await bundled('.cjs', '', true);
    const context = createContext({});
    runInContext(page, context);
    expect(runInContext('globalThis.pressed', context)).toBe('red');
    const journal = (runInContext(`globalThis[${JSON.stringify(EXECUTION_GLOBAL)}]`, context) as ExecutionCollector).drain();
    expect(journal.modules.map((module) => module.id.split('@')[0]).sort()).toEqual(['src/lib.cjs', 'src/main.cjs']);
  }, 60_000);
});
