import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createContext, runInContext } from 'node:vm';
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
// which no file holds, is not among them.

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
});
