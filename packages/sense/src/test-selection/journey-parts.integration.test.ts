import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { finalizeJestJourneys } from './jest-journey-artifact.js';
import { selectJourneyFile } from './journey-native.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/journey-parts');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('a journey across a service boundary', () => {
  it('charges what a service ran to the case that called it, joined after the run by the cookie alone', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-parts-'));
    temporary.push(directory);
    const journeyFile = resolve(directory, 'journeys.bin');
    const parts = resolve(directory, 'parts');
    // Jest and the service share nothing but the environment the service
    // inherits: a parts directory to write to and a label to build under. Each
    // test file starts its own service, so the two files' requests land in two
    // processes and two part files.
    await execute(process.execPath, [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'], {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_JOURNEYS: journeyFile,
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
        VARIANCE_AUTHORITY_PARTS: parts,
        VARIANCE_AUTHORITY_HEAD: 'pricing',
        VARIANCE_AUTHORITY_BUILD: resolve(directory, 'build'),
        XDG_CACHE_HOME: directory,
      },
    });
    expect(await readdir(parts)).toHaveLength(2);
    await finalizeJestJourneys(journeyFile);

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
    // process.
    expect(walking("return '$9.99'")).toEqual([at('test/refund.case.ts > refunds a small amount')]);
    // A case that never crossed the fence has nothing on the far side.
    expect(index.tests.map((test) => test.id)).not.toContain(at('test/quote.case.ts > never calls the service'));

    const change = (text: string) => new Map([[at('service/pricing.mjs'), [{ start: lineOf(text), end: lineOf(text) }]]]);
    expect((await selectJourneyFile(journeyFile, change("return '9,00 €'")))?.entered).toEqual([at('test/quote.case.ts')]);
    expect((await selectJourneyFile(journeyFile, change("return 'refunded'")))?.entered).toEqual([at('test/refund.case.ts')]);
    expect((await selectJourneyFile(journeyFile, change("return 'review'")))?.entered).toEqual([]);
  }, 120_000);
});
