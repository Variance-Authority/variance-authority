import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';

/**
 * A function handed to a page is not probed, and the module that hands it over is.
 *
 * `page.evaluate(fn)` sends `fn.toString()` to another realm, where the probe
 * runtime does not exist, so a probe inside `fn` throws there. `reader.js`
 * hands one function over inline and one by name, and reads a third thing in
 * this process. The fixture's page runs the text in a fresh `vm` context, which
 * has no more of this module's bindings than a browser does.
 *
 * Nothing inside a crossing function holds a region, so its text belongs to
 * the region around it: an edit inside the inline arrow reaches the test that
 * entered `title`, and an edit inside `countItems`, which is declared at the
 * top level, reaches every test that loaded the module.
 *
 * A declaration is hoisted: `countAll` exists from the moment `size` is
 * entered, and `size` hands it over before the early return its only test
 * takes. Its text sits after that return, where the test never arrives, so an
 * edit inside it reaches the test only when it is charged to the entry of the
 * function that declares it.
 *
 * Every `case` of a `switch` shares one block, so `countKinds`, written under
 * `default`, exists in the `case` that hands it over. An edit inside it reaches
 * the test that took that case only when it is charged to the region the
 * `switch` is reached in.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/crossing-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function record(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-crossing-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(
    process.execPath,
    [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory } },
  );
  return coverageFile;
}

const reader = named('src/reader.js');

const edited = (line: number, before: string, after: string) => `diff --git a/${reader} b/${reader}
--- a/${reader}
+++ b/${reader}
@@ -${line} +${line} @@
-${before}
+${after}
`;

describe('a function handed to a page', () => {
  it('runs without probes inside a module that keeps them', async () => {
    const coverageFile = await record();

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const regions = coverage.modules.find((module) => module.file === reader)
      ?.blocks.map((block) => [block.kind, block.name, block.testFiles]);
    const all = [
      named('test/count.test.js'),
      named('test/kind.test.js'),
      named('test/label.test.js'),
      named('test/size.test.js'),
      named('test/title.test.js'),
    ];
    expect(regions).toEqual([
      ['module', '', all],
      ['function', 'title', [named('test/title.test.js')]],
      ['function', 'count', [named('test/count.test.js')]],
      ['function', 'label', [named('test/label.test.js')]],
      ['function', 'size', [named('test/size.test.js')]],
      ['branch', 'size', [named('test/size.test.js')]],
      ['branch', 'size', []],
      ['continuation', 'size', []],
      ['function', 'size/countAll', [named('test/size.test.js')]],
      ['function', 'kind', [named('test/kind.test.js')]],
      ['case', 'kind', [named('test/kind.test.js')]],
      ['case', 'kind', []],
      ['function', 'kind/countKinds', [named('test/kind.test.js')]],
    ]);

    const inline = edited(2, '  return page.evaluate(() => document.title);', '  return page.evaluate(() => document.title.trim());');
    await expect(selectTestFiles(coverageFile, inline)).resolves.toEqual([named('test/title.test.js')]);

    const byName = edited(
      6,
      '  return document.items.filter((item) => item !== skipped).length;',
      '  return document.items.filter((item) => item === skipped).length;',
    );
    await expect(selectTestFiles(coverageFile, byName)).resolves.toEqual(all);

    const hoisted = edited(23, '    return document.items.length;', '    return document.items.length - 1;');
    await expect(selectTestFiles(coverageFile, hoisted)).resolves.toEqual([named('test/size.test.js')]);

    const otherCase = edited(33, '        return document.items.length;', '        return document.items.length - 1;');
    await expect(selectTestFiles(coverageFile, otherCase)).resolves.toEqual([named('test/kind.test.js')]);
  }, 20_000);
});
