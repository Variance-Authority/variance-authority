import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { journeyGaps } from './execution-set-format.js';
import { finalizeJestJourneys } from './jest-journey-artifact.js';
import { selectJourneyFile } from './journey-native.js';
import { receiveParts } from './parts-receiver.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/journey-parts');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const temporary: string[] = [];

// Jest and the service share nothing but the environment the service inherits:
// a parts directory to write to and a label to build under. Each test file
// starts its own service, so the three files' requests land in three processes
// and three part files.
const jestRun = (directory: string, journeyFile: string, parts: string, target: string) =>
  execute(process.execPath, [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'], {
    cwd: fixture,
    env: {
      ...process.env,
      VARIANCE_AUTHORITY_JOURNEYS: journeyFile,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
      VARIANCE_AUTHORITY_PARTS: target,
      PARTS_DIRECTORY: parts,
      VARIANCE_AUTHORITY_HEAD: 'pricing',
      VARIANCE_AUTHORITY_BUILD: resolve(directory, 'build'),
      VARIANCE_AUTHORITY_CACHE: directory,
    },
  });

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// A service with a filesystem writes its parts in place; one without sends
// them to a receiver that writes the same files. The fold cannot tell.
const targets = {
  'into a directory': async (parts: string) => ({ target: parts, close: async () => {} }),
  'through a receiver': async (parts: string) => {
    const receiver = await receiveParts(parts);
    return { target: receiver.url, close: receiver.close };
  },
};

describe.each(Object.entries(targets))('a journey across a service boundary, written %s', (_, open) => {
  it('charges what a service ran to the case that called it, joined after the run by the cookie alone', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-parts-'));
    temporary.push(directory);
    const journeyFile = resolve(directory, 'journeys.bin');
    const parts = resolve(directory, 'parts');
    const sink = await open(parts);
    await jestRun(directory, journeyFile, parts, sink.target).finally(sink.close);
    const written = await readdir(parts);
    expect(written).toHaveLength(3);
    const finalized = await finalizeJestJourneys(journeyFile);
    // The silent file's service was never handed a journey, so what it ran is
    // no case's: the finalize names its part rather than guessing an owner.
    expect(finalized.unclaimed).toHaveLength(1);
    expect(written).toContain(finalized.unclaimed![0]);
    expect(finalized.unrecorded).toEqual([]);
    // No artifact was there before this one, so no head can have gone quiet.
    expect(finalized.silent).toBeUndefined();
    // The artifact carries what the finalize named, for a reader after it.
    expect(journeyGaps(await readFile(journeyFile))).toEqual({
      unrecorded: [],
      unclaimed: finalized.unclaimed,
      heads: ['pricing'],
    });

    const index = decodeExecutionIndex(await readFile(journeyFile));
    const pricing = index.modules.find((module) => module.file === at('service/pricing.mjs'));
    expect(pricing).toBeDefined();
    const source = await readFile(resolve(fixture, 'service/pricing.mjs'), 'utf8');
    const lineOf = (text: string): number => source.slice(0, source.indexOf(text)).split('\n').length;
    const walking = (text: string): readonly string[] => {
      const line = lineOf(text);
      const block = pricing!.blocks
        .filter((candidate) => candidate.startLine <= line && line <= candidate.endLine)
        .sort((left, right) => left.startLine - right.startLine)
        .at(-1);
      return block!.crossings.map((crossing) => index.tests[crossing.test]!.id).sort();
    };

    // One branch, one case, on the far side of an HTTP request.
    expect(walking("return '9,00 €'")).toEqual([at('test/quote.case.ts > quotes in euros')]);
    expect(walking("return '£7.80'")).toEqual([at('test/quote.case.ts > quotes in pounds')]);
    expect(walking("return 'refunded'")).toEqual([at('test/refund.case.ts > refunds a small amount')]);
    expect(walking("return 'review'")).toEqual([]);
    // A request that carried no journey is still the process's work, and it is
    // charged to every case that process served: the refund file's service
    // answered it, so the refund file is selected when it changes. It is
    // never charged to the other file's cases, whose requests went to another
    // process, nor to the silent file's, whose process served no journey.
    expect(walking("return '$9.99'")).toEqual([at('test/refund.case.ts > refunds a small amount')]);
    // A case that never crossed the fence ran, so the index names it, and
    // nothing on the far side is charged to it.
    const silent = index.tests.findIndex((test) => test.id === at('test/quote.case.ts > never calls the service'));
    expect(silent).toBeGreaterThanOrEqual(0);
    expect(pricing!.blocks.some((block) => block.crossings.some((crossing) => crossing.test === silent))).toBe(false);

    const change = (text: string) => new Map([[at('service/pricing.mjs'), [{ start: lineOf(text), end: lineOf(text) }]]]);
    expect((await selectJourneyFile(journeyFile, change("return '9,00 €'")))?.entered).toEqual([at('test/quote.case.ts')]);
    expect((await selectJourneyFile(journeyFile, change("return 'refunded'")))?.entered).toEqual([at('test/refund.case.ts')]);
    expect((await selectJourneyFile(journeyFile, change("return 'review'")))?.entered).toEqual([]);

    // The next run's service writes where the fold does not read: the finalize
    // reads the artifact it replaces and names the head that wrote parts then
    // and none now.
    const nowhere = resolve(directory, 'nowhere');
    await mkdir(nowhere);
    await jestRun(directory, journeyFile, nowhere, resolve(directory, 'elsewhere'));
    const quiet = await finalizeJestJourneys(journeyFile);
    expect(quiet.silent).toEqual(['pricing']);
    expect(journeyGaps(await readFile(journeyFile))).toMatchObject({ heads: [], silent: ['pricing'] });
  }, 120_000);
});
