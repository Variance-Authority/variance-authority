import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECKOUT_MARKER } from './cache-layers.js';
import { lineAt, linesOf } from './case-lines.js';
import { caseIndexOf, caseSectionsOf } from './case-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import { openSetColumns } from './execution-set-format.js';
import { RecordWithoutCoverage } from './format-validation.js';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';
// The runner's modules `require` the collectors, so they are loaded built, and
// through the export a runner's author imports.
const { cutTestFile, instrumentModule, observeTestFile, registerRecording, RECORDING_VARIABLE } =
  (await import('@variance-authority/sense/runner')) as typeof import('./runner.js');

const stories = (await import('../../dist/story/format.cjs')).default as typeof import('../story/format.cjs');

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-runner');
// Recorded names are relative to the checkout, and the fixture sits inside it.
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];
/** Past the largest pid Linux or macOS hands out, so no process has it. */
const NO_PROCESS = 2 ** 22 + 1;

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Runs the fixture's own runner: `startRecording`, one forked process per test file, then `finish`. */
async function record(...flags: string[]): Promise<{ coverageFile: string; stderr: string }> {
  return await recordInto(await cacheDirectory(), flags);
}

async function cacheDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-runner-'));
  temporary.push(directory);
  return directory;
}

/** The same run, with `directory` as its cache, so a test can put something there first. */
async function recordInto(
  directory: string,
  flags: readonly string[] = [],
  asked: Readonly<Record<string, string>> = {},
): Promise<{ coverageFile: string; stderr: string }> {
  const coverageFile = resolve(directory, 'coverage.bin');
  const { [RECORDING_VARIABLE]: _open, ...environment } = process.env;
  const { stderr } = await execute(process.execPath, [resolve(fixture, 'run.mjs'), ...flags], {
    cwd: fixture,
    env: { ...environment, ...asked, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  return { coverageFile, stderr };
}

const lineIn = (source: string, text: string): number => source.slice(0, source.indexOf(text)).split('\n').length;

describe('a runner with no seam, through @variance-authority/sense/runner', () => {
  it('records which files each test file loaded under the loads recipe, with no case index', async () => {
    const { coverageFile } = await record('--loads');

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.modules.every((module) => !module.instrumented && module.blocks.length === 0)).toBe(true);
    expect(caseSectionsOf(await readFile(coverageFile)).index).toBeUndefined();
    const label = await readFile(resolve(fixture, 'src/label.cjs'), 'utf8');
    const line = lineIn(label, "    return 'took A';");
    // Both files loaded the module; nothing says which of them reached the line.
    await expect(selectTestFiles(coverageFile, `--- a/${at('src/label.cjs')}\n+++ b/${at('src/label.cjs')}\n@@ -${line},1 +${line},1 @@\n-    return 'took A';\n+    return 'went A';`))
      .resolves.toEqual([at('test/alpha.case.mjs'), at('test/beta.case.mjs')]);
  });

  it('records ES modules, CommonJS and TypeScript across processes, and selects the file that covered a changed line', async () => {
    const { coverageFile } = await record();

    const decide = await readFile(resolve(fixture, 'src/decide.mjs'), 'utf8');
    const label = await readFile(resolve(fixture, 'src/label.cjs'), 'utf8');
    const changing = (file: string, source: string, from: string, to: string): string => {
      const line = lineIn(source, from);
      return `--- a/${at(file)}\n+++ b/${at(file)}\n@@ -${line},1 +${line},1 @@\n-${from}\n+${to}`;
    };

    await expect(selectTestFiles(coverageFile, changing('src/label.cjs', label, "    return 'took A';", "    return 'went A';")))
      .resolves.toEqual([at('test/alpha.case.mjs')]);
    await expect(selectTestFiles(coverageFile, changing('src/decide.mjs', decide, "  return `${label('B')}, ${weigh(value)}`;", "  return label('B');")))
      .resolves.toEqual([at('test/beta.case.mjs')]);
    // TypeScript Node stripped itself, recorded in the lines its author wrote.
    const weigh = await readFile(resolve(fixture, 'src/weigh.mts'), 'utf8');
    await expect(selectTestFiles(coverageFile, changing('src/weigh.mts', weigh, "  return 'light';", "  return 'slight';")))
      .resolves.toEqual([at('test/beta.case.mjs')]);
    await expect(selectTestFiles(coverageFile, changing('src/weigh.mts', weigh, "    return 'heavy';", "    return 'weighty';")))
      .resolves.toEqual([]);

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.modules.map((module) => module.file).sort()).toEqual([
      at('src/decide.mjs'),
      at('src/label.cjs'),
      at('src/weigh.mts'),
    ]);
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
      [at('test/alpha.case.mjs'), true],
      [at('test/beta.case.mjs'), true],
    ]);
    // The runner's own files are what every outcome depends on and no transform saw.
    expect(coverage.tests[0]!.preconditions.map((precondition) => precondition.name)).toEqual([
      at('run.mjs'),
      at('test/alpha.case.mjs'),
      at('worker.mjs'),
    ]);
  }, 60_000);

  it('selects every file that loaded a module named unprobed, for an edit to a line none of them ran', async () => {
    const { coverageFile } = await record('--weigh-unprobed');

    const weigh = await readFile(resolve(fixture, 'src/weigh.mts'), 'utf8');
    const line = lineIn(weigh, "    return 'heavy';");
    const diff = `--- a/${at('src/weigh.mts')}\n+++ b/${at('src/weigh.mts')}\n@@ -${line},1 +${line},1 @@\n-    return 'heavy';\n+    return 'weighty';`;

    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual([at('test/alpha.case.mjs'), at('test/beta.case.mjs')]);
    expect(decodeTestCoverage(await readFile(coverageFile)).modules.find((module) => module.file === at('src/weigh.mts')))
      .toEqual(expect.objectContaining({ instrumented: false, blocks: [] }));
  }, 60_000);

  it.todo('marks a module a runner with its own transform must not probe — needs a marking sibling of `instrumentModule` published on `./runner`');

  it('names each case by its declaration path, and gives a branch only to the case that walked it', async () => {
    const { coverageFile } = await record();
    const index = decodeExecutionIndex(await readFile(coverageFile));
    expect(index.tests.map((test) => test.id)).toEqual([
      at('test/alpha.case.mjs > decide > takes the alpha path'),
      at('test/alpha.case.mjs > decide > waits, then takes the alpha path'),
      at('test/beta.case.mjs > decide > takes the beta path'),
    ]);

    const label = index.modules.find((module) => module.file === at('src/label.cjs'));
    expect(label).toBeDefined();
    const source = await readFile(resolve(fixture, 'src/label.cjs'), 'utf8');
    const walking = (returned: string): readonly string[] => {
      const line = lineIn(source, `return '${returned}'`);
      const block = label!.blocks
        .filter((candidate) => candidate.startLine <= line && line <= candidate.endLine)
        .sort((left, right) => left.startLine - right.startLine)
        .at(-1);
      expect(block, returned).toBeDefined();
      return block!.crossings.map((crossing) => index.tests[crossing.test]!.id).sort();
    };
    // The awaited case is still the one that walked its branch after the timer.
    expect(walking('took A')).toEqual([
      at('test/alpha.case.mjs > decide > takes the alpha path'),
      at('test/alpha.case.mjs > decide > waits, then takes the alpha path'),
    ]);
    expect(walking('took B')).toEqual([at('test/beta.case.mjs > decide > takes the beta path')]);
  }, 60_000);

  it('says which line of each case reached the branch it took, unless the run turns cuts off', async () => {
    const source = await readFile(resolve(fixture, 'src/label.cjs'), 'utf8');
    const test = await readFile(resolve(fixture, 'test/alpha.case.mjs'), 'utf8');
    const reaching = async (coverageFile: string, name: string) => {
      const cases = await caseIndexOf(coverageFile);
      if (cases === undefined) throw new Error('the run wrote no execution index');
      const index = decodeExecutionIndex(cases);
      const module = index.modules.findIndex((entry) => entry.file === at('src/label.cjs'));
      const line = lineIn(source, "return 'took A'");
      const block = index.modules[module]!.blocks.findLastIndex((entry) => entry.startLine <= line && line <= entry.endLine);
      const lines = linesOf(openSetColumns(cases)!.testLines, index.tests.findIndex((entry) => entry.id === at(`test/alpha.case.mjs > ${name}`)));
      return lines === undefined ? undefined : lineAt(lines, module, block);
    };

    const { coverageFile } = await record();
    expect(await reaching(coverageFile, 'decide > takes the alpha path'))
      .toEqual({ line: lineIn(test, "if (decide('alpha')"), ambient: false });
    // The awaited case waited first; the call after the wait reached the branch.
    expect(await reaching(coverageFile, 'decide > waits, then takes the alpha path'))
      .toEqual({ line: test.split('\n').findLastIndex((text) => text.includes("decide('alpha')")) + 1, ambient: false });

    const uncut = await record('--no-cadence');
    expect(await reaching(uncut.coverageFile, 'decide > takes the alpha path')).toBeUndefined();
  }, 60_000);

  it('writes a story for each case it runs under `VARIANCE_AUTHORITY_STORY=1`, and none without it', async () => {
    const written = async (asked: Record<string, string>): Promise<string[]> => {
      const directory = await cacheDirectory();
      await recordInto(directory, [], asked);
      const paths = (await readdir(directory, { recursive: true })).filter((path) => path.endsWith('.story'));
      return (await Promise.all(paths.map(async (path) => stories.decodeStory(await readFile(resolve(directory, path))).name))).sort();
    };

    expect(await written({})).toEqual([]);
    expect(await written({ VARIANCE_AUTHORITY_STORY: '1' })).toEqual([
      'decide > takes the alpha path',
      'decide > takes the beta path',
      'decide > waits, then takes the alpha path',
    ]);
  }, 60_000);

  it('keeps the duration the runner passed to `finish` for each file and for each case it named', async () => {
    const { coverageFile } = await record();

    const files = decodeTestCoverage(await readFile(coverageFile)).tests;
    expect(files.map((test) => typeof test.duration)).toEqual(['number', 'number']);
    const cases = decodeExecutionIndex(await readFile(coverageFile)).tests;
    expect(cases.map((test) => typeof test.duration)).toEqual(['number', 'number', 'number']);
    // The case that waits five milliseconds on a timer is the one the worker timed at five or more.
    const waited = cases.find((test) => test.name.includes('waits'));
    expect(waited?.duration).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it('says so when no process instrumented anything, rather than writing a record that reaches nothing quietly', async () => {
    const { coverageFile, stderr } = await record('--no-hooks');
    // Its coverage is absent rather than empty.
    const bytes = await readFile(coverageFile);
    expect(() => decodeTestCoverage(bytes)).toThrow(RecordWithoutCoverage);
    expect(stderr).toContain('instrumented 0 modules across 2 test file(s)');
    expect(stderr).toContain('check that registerRecording() or instrumentModule() runs in every process');
  }, 60_000);

  it('names a precondition\'s call site from the checkout in what it warns, as the row would', async () => {
    const { stderr } = await record('--says-a-wrong-value');

    expect(stderr).toMatch(new RegExp(`variancePrecondition at ${at('worker.mjs')}:\\d+ takes a dimension and a record of keys to values`));
  }, 60_000);

  it('keeps a file incomplete when its probes fired and nothing the run reads says what they meant', async () => {
    const { coverageFile } = await record('--names-another-root');
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    // What each file reached is not known, so it is evidence that selects the
    // file and never a reach that skips it.
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
      [at('test/alpha.case.mjs'), false],
      [at('test/beta.case.mjs'), false],
    ]);
  }, 60_000);

  it('leaves what other runs left in the cache where it is, however long ago the cache was pruned', async () => {
    const cache = await mkdtemp(resolve(tmpdir(), 'variance-authority-runner-'));
    temporary.push(cache);
    // A layer of a checkout that is still there, holding the scratch of a run
    // whose process has exited: what a prune removes. No stamp, so one is due.
    const layer = resolve(cache, 'test-selection', 'elsewhere');
    await mkdir(layer, { recursive: true });
    await writeFile(resolve(layer, CHECKOUT_MARKER), JSON.stringify({ checkout: cache, primary: cache }));
    const dead = resolve(layer, `.run-${NO_PROCESS}-left`);
    await mkdir(dead);
    const hoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    await utimes(dead, hoursAgo, hoursAgo);

    await recordInto(cache);

    expect(existsSync(dead)).toBe(true);
  }, 60_000);

  it('does nothing outside a recording, so the runner code is the same either way', () => {
    const { [RECORDING_VARIABLE]: open } = process.env;
    delete process.env[RECORDING_VARIABLE];
    try {
      const code = 'export const answer = 42;\n';
      expect(instrumentModule(code, resolve(fixture, 'src/answer.mjs'))).toBe(code);
      expect(cutTestFile(code, resolve(fixture, 'test/alpha.case.mjs'))).toBe(code);
      expect(registerRecording()).toBeUndefined();
      expect(observeTestFile(resolve(fixture, 'test/alpha.case.mjs'))).toBeUndefined();
    } finally {
      if (open !== undefined) process.env[RECORDING_VARIABLE] = open;
    }
  });

  it('marks a module it cannot parse as loaded, so the test that loaded it still reports it', () => {
    const { [RECORDING_VARIABLE]: open } = process.env;
    process.env[RECORDING_VARIABLE] = JSON.stringify({
      root: repository,
      runDirectory: fixture,
      caseDirectory: fixture,
      mode: 'presence',
      continuations: false,
    });
    try {
      const broken = 'export const = ;\n';
      const code = instrumentModule(broken, resolve(fixture, 'src/broken.mjs'));
      expect(code.startsWith(broken)).toBe(true);
      expect(code.slice(broken.length)).toMatch(new RegExp(`^\\n;globalThis\\.__VA__\\.m\\("${at('src/broken.mjs')}@[0-9a-f]+"\\);$`));
    } finally {
      if (open === undefined) delete process.env[RECORDING_VARIABLE];
      else process.env[RECORDING_VARIABLE] = open;
    }
  });
});
