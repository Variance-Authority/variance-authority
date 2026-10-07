import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { decodeExecutionIndex, type ExecutionIndex } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A real Playwright run over a spec that says what its cases arranged, from the
// body and from hooks, recorded through `varianceFixtures` the way a suite
// records — the page hands over a crossing, as an instrumented build's would.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/preconditions');
const specs = `${relative(repository, fixture)}/tests`;

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test preconditions: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

// The parts of Playwright's JSON report read here.
interface PlaywrightNote { readonly type: string; readonly description?: string }
interface PlaywrightSpec {
  readonly title: string;
  readonly tests: readonly {
    readonly projectName: string;
    readonly annotations: readonly PlaywrightNote[];
    readonly results: readonly { readonly annotations?: readonly PlaywrightNote[] }[];
  }[];
}
interface PlaywrightSuite { readonly specs?: readonly PlaywrightSpec[]; readonly suites?: readonly PlaywrightSuite[] }
interface PlaywrightReport { readonly suites: readonly PlaywrightSuite[] }

describe.runIf(BROWSER_AVAILABLE)('a Playwright case that names its preconditions', () => {
  let directory: string;
  let index: ExecutionIndex;
  let output: string;
  let source: Readonly<Record<string, readonly string[]>>;
  let report: PlaywrightReport;

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-preconditions-playwright-'));
    const cacheRoot = resolve(directory, 'cache');
    const coverageFile = resolve(directory, 'coverage.bin');
    const reportFile = resolve(directory, 'report.json');
    output = await execute(
      process.execPath,
      [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs')],
      {
        cwd: fixture,
        env: {
          ...process.env,
          VARIANCE_AUTHORITY_COVERAGE: coverageFile,
          VARIANCE_AUTHORITY_CACHE: cacheRoot,
          VARIANCE_AUTHORITY_BASELINES: resolve(directory, 'baselines'),
          VARIANCE_AUTHORITY_REPORT: reportFile,
        },
      },
    ).then(({ stdout, stderr }) => `${stdout}${stderr}`);
    index = decodeExecutionIndex(await readFile(coverageFile));
    const lines = async (file: string) => (await readFile(resolve(fixture, 'tests', file), 'utf8')).split('\n');
    source = { 'checkout.spec.ts': await lines('checkout.spec.ts'), 'flags.spec.ts': await lines('flags.spec.ts') };
    report = JSON.parse(await readFile(reportFile, 'utf8')) as PlaywrightReport;
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  // The level each call is said at: the describes around the `beforeEach` that
  // said it, or the case's own, which is narrower than any of them.
  const levels: Readonly<Record<string, number>> = { 'mocked each': 1, 'file flag': 0, 'describe flag': 1 };
  // Each call's comment is unique across the fixture's specs, so it names its file too.
  const fileOf = (call: string): string =>
    Object.keys(source).find((file) => source[file]!.some((text) => text.endsWith(`// ${call}`)))!;
  const line = (call: string): number => source[fileOf(call)]!.findIndex((text) => text.endsWith(`// ${call}`)) + 1;
  const said = (name: string, value: string | number | boolean, call: string) =>
    ({ name, value, site: `${specs}/${fileOf(call)}:${line(call)}`, level: levels[call] ?? 0xffff });
  const annotated = (project: string, title: string): readonly string[] => {
    const walk = (suite: PlaywrightSuite): PlaywrightSpec[] => [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(walk)];
    const found = report.suites.flatMap(walk).filter((each) => each.title === title).flatMap((each) => each.tests)
      .find((test) => test.projectName === project);
    expect(found, `${title} in ${project}`).toBeDefined();
    const notes = [...found!.annotations, ...found!.results.flatMap((result) => result.annotations ?? [])];
    return [...new Set(notes.filter((note) => note.type === 'variance').map((note) => note.description))];
  };
  const row = (...path: readonly string[]) => {
    const name = path.join(' > ');
    const found = index.tests.find((test) => test.name === name);
    expect(found, `${name} among ${index.tests.map((test) => test.name).join(', ')}`).toBeDefined();
    return found!;
  };

  it('carries what its body said, with the call site, over what a beforeEach said', () => {
    expect(row('mocked', 'refunds behind a flag').preconditions).toEqual([
      said('flag', 'ff-on', 'case flag'),
      said('network', 'mocked', 'mocked each'),
    ]);
    expect(row('live', 'replays a recording').preconditions).toEqual([said('network', 'recorded', 'case network')]);
  });

  it('carries what a beforeEach inside a describe said, which a sibling describe never hears', () => {
    expect(row('mocked', 'pays').preconditions).toEqual([said('network', 'mocked', 'mocked each')]);
    expect(row('live', 'replays a recording').preconditions?.some((held) => held.value === 'mocked')).toBe(false);
  });

  // A Playwright without one of the internals read refuses at setup, so every
  // test fails and the run exits non-zero before any row is written.
  it('reads every internal it needs to say a hook’s describe from the installed Playwright', () => {
    expect(output).not.toMatch(/cannot say which describe declared a beforeEach/);
    expect(row('flag on', 'reads the exception').preconditions).not.toEqual([]);
  });

  it('lets a beforeEach inside a describe override one at the top of the file', () => {
    expect(row('flag on', 'reads the exception').preconditions).toEqual([said('flag', 'ff-on', 'describe flag')]);
  });

  it('keeps a beforeEach inside a describe from a sibling describe, which hears the top of the file', () => {
    expect(row('flag left alone', 'reads the default').preconditions).toEqual([said('flag', 'ff-off', 'file flag')]);
  });

  it('places a beforeEach one helper declares at two depths at the depth of the one running', () => {
    expect(row('tier outer', 'tier inner', 'reads the inner tier').preconditions).toEqual([
      said('flag', 'ff-off', 'file flag'),
      { ...said('tier', 'silver', 'helper tier'), level: 2 },
    ]);
  });

  it('keeps two values said at one level as a contradiction', () => {
    expect(row('contradicted').preconditions).toEqual([
      said('flag', 'ff-off', 'contradicted off'),
      said('flag', 'ff-on', 'contradicted on'),
    ]);
  });

  it('gives a case that said something a row, and a case that said nothing an empty one', () => {
    expect(row('crosses nothing').preconditions).toEqual([said('seeded', true, 'seeded')]);
    expect(row('says nothing').preconditions).toEqual([]);
  });

  it('reports a call in afterEach with its site and lays it on no case', () => {
    expect(output).toMatch(new RegExp(`variancePrecondition at \\S*checkout\\.spec\\.ts:${line('after each')} ran after its case`));
    expect(index.tests.flatMap((test) => test.preconditions ?? []).some((held) => held.name === 'cleaned')).toBe(false);
  });

  it('names the case a snapshot was taken in, and what it had arranged by then', () => {
    expect(row('mocked', 'photographs the receipt').preconditions).toEqual([
      said('flag', 'ff-on', 'receipt flag'),
      said('network', 'mocked', 'mocked each'),
      said('seeded', true, 'receipt seeded'),
    ]);
    // The call after the snapshot is on the row and not on the snapshot.
    expect(annotated('listening', 'photographs the receipt')).toEqual([
      `receipt--ff-on: taken in ${specs}/checkout.spec.ts > mocked > photographs the receipt, ran under ` +
        `flag=ff-on (${specs}/checkout.spec.ts:${line('receipt flag')}), network=mocked (${specs}/checkout.spec.ts:${line('mocked each')})`,
    ]);
  });

  // A run that did not listen has nothing to say under a passing test, so the
  // default run's report stays as it was; a failing message still says
  // unmeasured (docket.test.ts).
  it('adds no annotation for a snapshot from a run that did not listen', () => {
    expect(annotated('deaf', 'photographs the receipt')).toEqual([]);
  });

  it.todo('throws for a call at the top level or in a describe callback of the first file a worker loads — needs the listener installed before the worker fixture, which Playwright sets up after the file is collected');
});
