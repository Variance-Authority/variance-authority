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
const fixture = resolve(repository, 'packages/sense/test/fixtures/journey-trace');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe.each([
  ['sentry', []],
  ['opentelemetry', []],
  ['sentry', ['--runInBand']],
  ['opentelemetry', ['--runInBand']],
])('a journey carried by %s %j', (tracer, band) => {
  it('charges both services a case reached through the application tracing, with no cookie and no enter', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-trace-'));
    temporary.push(directory);
    const journeyFile = resolve(directory, 'journeys.bin');
    const parts = resolve(directory, 'parts');
    await execute(process.execPath, [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', ...band], {
      cwd: fixture,
      env: {
        ...process.env,
        TRACER: tracer,
        VARIANCE_AUTHORITY_JOURNEYS: journeyFile,
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
        VARIANCE_AUTHORITY_PARTS: parts,
        VARIANCE_AUTHORITY_BUILD: resolve(directory, 'build'),
        XDG_CACHE_HOME: directory,
      },
    });
    // Two test files, each with its own checkout and pricing.
    expect(await readdir(parts)).toHaveLength(4);
    await finalizeJestJourneys(journeyFile);

    const index = decodeExecutionIndex(await readFile(journeyFile));
    const sources = new Map<string, string>();
    for (const name of ['checkout', 'pricing']) {
      sources.set(name, await readFile(resolve(fixture, `service/${name}.mjs`), 'utf8'));
    }
    const lineOf = (service: string, text: string): number => {
      const source = sources.get(service)!;
      return source.slice(0, source.indexOf(text)).split('\n').length;
    };
    const walking = (service: string, text: string): readonly string[] => {
      const module = index.modules.find((candidate) => candidate.file === at(`service/${service}.mjs`));
      expect(module).toBeDefined();
      const line = lineOf(service, text);
      const block = module!.blocks
        .filter((candidate) => candidate.startLine <= line && line <= candidate.endLine)
        .sort((left, right) => left.startLine - right.startLine)
        .at(-1);
      return block!.crossings.map((crossing) => index.tests[crossing.test]!.id).sort();
    };

    const euros = at('test/quote.case.ts > quotes in euros');
    const pounds = at('test/quote.case.ts > quotes in pounds');
    const refunds = at('test/refund.case.ts > refunds a small amount');
    // One branch, one case, one hop away and two.
    expect(walking('checkout', "return 'basket in euros'")).toEqual([euros]);
    expect(walking('pricing', "return '9,00 €'")).toEqual([euros]);
    expect(walking('checkout', "return 'basket in pounds'")).toEqual([pounds]);
    expect(walking('pricing', "return '£7.80'")).toEqual([pounds]);
    expect(walking('checkout', "return 'return accepted'")).toEqual([refunds]);
    expect(walking('pricing', "return 'refunded'")).toEqual([refunds]);
    expect(walking('pricing', "return 'review'")).toEqual([]);
    // A call from outside any case rides a trace no case handed out, and each
    // service charges it to every case it served — never to the other file's.
    expect(walking('checkout', "return 'basket in dollars'")).toEqual([euros, pounds]);
    expect(walking('pricing', "return '$9.99'")).toEqual([euros, pounds]);
    // Under a trace every case carries its journey from its first line, since
    // nothing knows ahead whether the tracer will send it anywhere. A case that
    // never crossed is listed, and reached nothing beyond the fence.
    const never = index.tests.findIndex((test) => test.id === at('test/quote.case.ts > never calls the service'));
    expect(never).toBeGreaterThanOrEqual(0);
    expect(
      index.modules
        .filter((module) => module.file.startsWith(at('service/')))
        .flatMap((module) => module.blocks)
        .flatMap((block) => block.crossings)
        .map((crossing) => crossing.test),
    ).not.toContain(never);

    const change = (service: string, text: string) =>
      new Map([[at(`service/${service}.mjs`), [{ start: lineOf(service, text), end: lineOf(service, text) }]]]);
    expect((await selectJourneyFile(journeyFile, change('pricing', "return 'refunded'")))?.entered).toEqual([
      at('test/refund.case.ts'),
    ]);
    expect((await selectJourneyFile(journeyFile, change('checkout', "return 'basket in euros'")))?.entered).toEqual([
      at('test/quote.case.ts'),
    ]);
  }, 120_000);
});
