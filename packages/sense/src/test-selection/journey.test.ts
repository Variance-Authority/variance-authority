import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executionCollectorSource, testSelectionProbes } from './probes.js';
import { joinObservations, recordExecution } from './journal.js';
import {
  JOURNEY_COOKIE,
  JOURNEY_DIRECTORY_VARIABLE,
  JOURNEY_HEAD_VARIABLE,
  collectJourneys,
  journeyOf,
  mintJourney,
  readJourneyReports,
  stitchJourneys,
} from './journey.js';
import { selectTestFiles } from './index.js';

/**
 * A module that decides, then awaits, then decides again.
 *
 * The `await` is the whole point. Everything after it is instrumented too, so
 * two callers overlap inside one module rather than merely following each other
 * through it — which is the only arrangement under which a shared counter set
 * gives a crossing to the wrong subject.
 */
const SOURCE = [
  'async function later(value) {',
  '  return value;',
  '}',
  'async function currency(locale) {',
  '  if (locale === "de") {',
  '    return `${await later(1200)} euros`;',
  '  }',
  '  return `${await later(1200)} dollars`;',
  '}',
  'globalThis.__head_test_currency = currency;',
].join('\n');

const EURO_LINE = 6;
const DOLLAR_LINE = 8;

type Currency = (locale: string) => Promise<string>;

/** Evaluate the transformed module the way a service's loader would. */
function evaluate(transformed: string): Currency {
  new Function(transformed.replace(/^import "[^"]+";/, ''))();
  return (globalThis as unknown as Record<string, unknown>)['__head_test_currency'] as Currency;
}

afterEach(() => {
  const global = globalThis as unknown as Record<string, unknown>;
  delete global['__head_test_currency'];
  delete global['__VA__'];
});

async function inRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-journey-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function diffAt(file: string, line: number): string {
  return `--- a/${file}\n+++ b/${file}\n@@ -${line},1 +${line},1 @@\n`;
}

interface Head {
  readonly directory: string;
  readonly modulesFile: string;
  readonly coverageFile: string;
  readonly currency: Currency;
}

/** Instrument the module, install the collector, and evaluate — in that order. */
async function head(root: string, label = 'build'): Promise<Head> {
  const modulesFile = resolve(root, `modules-${label}.json`);
  const module = resolve(root, 'currency.js');
  await writeFile(module, SOURCE, 'utf8');
  const plugin = testSelectionProbes({ root, modulesFile });
  const transformed = plugin.transform.call(
    { getCombinedSourcemap: () => ({ mappings: '' }) },
    SOURCE,
    module,
  )!;
  await plugin.buildEnd();
  return {
    directory: resolve(root, 'journeys'),
    modulesFile,
    coverageFile: resolve(root, 'coverage.bin'),
    currency: evaluate(transformed.code),
  };
}

describe('a head reports what each journey entered', () => {
  it('keeps two journeys apart while they interleave inside one module', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      const collector = collectJourneys({ head: 'api', directory });
      const parts = await head(root);
      const german = mintJourney();
      const english = mintJourney();

      // Both start before either finishes: `currency('de')` runs to its await,
      // yields, and `currency('en')` enters the same module underneath it.
      const [first, second] = await Promise.all([
        collector.enter(german, () => parts.currency('de')),
        collector.enter(english, () => parts.currency('en')),
      ]);
      collector.close();
      expect([first, second]).toEqual(['1200 euros', '1200 dollars']);

      const stitched = await stitchJourneys({
        directory,
        heads: ['api'],
        owners: new Map([
          [german, 'euros.spec.ts'],
          [english, 'dollars.spec.ts'],
        ]),
      });
      expect(stitched).toMatchObject({ complete: true, silent: [], unclaimed: 0 });

      const recorded = await recordExecution({
        root,
        modulesFile: parts.modulesFile,
        coverageFile: parts.coverageFile,
        subjects: stitched.heads.get('api')!,
      });
      expect(recorded).toMatchObject({ recorded: true, subjects: 2 });

      expect(await selectTestFiles(parts.coverageFile, diffAt('currency.js', EURO_LINE))).toEqual([
        'euros.spec.ts',
      ]);
      expect(await selectTestFiles(parts.coverageFile, diffAt('currency.js', DOLLAR_LINE))).toEqual(
        ['dollars.spec.ts'],
      );
    });
  });

  it('gives both subjects both branches when the same run carries no journey', async () => {
    // The control, and the reason the case above is evidence rather than a
    // coincidence: identical source, identical interleaving, one counter set.
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      const collector = collectJourneys({ head: 'api', directory });
      const parts = await head(root);

      await Promise.all([
        collector.enter(undefined, () => parts.currency('de')),
        collector.enter(undefined, () => parts.currency('en')),
      ]);
      collector.close();

      const stitched = await stitchJourneys({
        directory,
        heads: ['api'],
        owners: new Map([
          [mintJourney(), 'euros.spec.ts'],
          [mintJourney(), 'dollars.spec.ts'],
        ]),
      });
      await recordExecution({
        root,
        modulesFile: parts.modulesFile,
        coverageFile: parts.coverageFile,
        subjects: stitched.heads.get('api')!,
      });

      expect(await selectTestFiles(parts.coverageFile, diffAt('currency.js', EURO_LINE))).toEqual([
        'dollars.spec.ts',
        'euros.spec.ts',
      ]);
    });
  });

  it('attributes a scope to the journey until what it returned settles', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      const collector = collectJourneys({ head: 'api', directory });
      const parts = await head(root);
      const journey = mintJourney();
      await collector.enter(journey, () => parts.currency('de'));
      collector.close();

      const reports = await readJourneyReports(directory);
      const mine = reports.filter((report) => report.journey === journey);
      expect(mine).toHaveLength(1);
      // Not just the entry block: the resume block after the `await` is in here
      // too, and a drain at the request boundary is what loses it.
      expect(mine[0]!.modules[0]!.hits.length).toBeGreaterThan(1);
      expect(mine[0]!.head).toBe('api');
    });
  });
});

describe('a head that was not there', () => {
  it('refuses to let any subject in the run justify an exclusion', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      const collector = collectJourneys({ head: 'api', directory });
      const parts = await head(root);
      const journey = mintJourney();
      await collector.enter(journey, () => parts.currency('de'));
      collector.close();

      const stitched = await stitchJourneys({
        directory,
        heads: ['api', 'pricing'],
        owners: new Map([[journey, 'euros.spec.ts']]),
      });
      expect(stitched.complete).toBe(false);
      expect(stitched.silent).toEqual(['pricing']);
      expect(stitched.because).toContain('pricing');
      expect(stitched.because).toContain('may justify an exclusion');
      expect(stitched.heads.get('api')!.every((subject) => subject.complete === false)).toBe(true);
    });
  });

  it('drops out of the whole observations a later run may narrow by', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      const collector = collectJourneys({ head: 'api', directory });
      const parts = await head(root);
      const journey = mintJourney();
      await collector.enter(journey, () => parts.currency('de'));
      collector.close();

      const stitched = await stitchJourneys({
        directory,
        heads: ['api', 'pricing'],
        owners: new Map([[journey, 'euros.spec.ts']]),
      });
      await recordExecution({
        root,
        modulesFile: parts.modulesFile,
        coverageFile: parts.coverageFile,
        subjects: stitched.heads.get('api')!,
      });

      const { narrowByExecution } = await import('./index.js');
      const narrowed = await narrowByExecution(
        parts.coverageFile,
        diffAt('currency.js', EURO_LINE),
      );
      // The crossings are there — the subject entered the changed line — and the
      // ground still may not spend them, because `whole` is what it skips from.
      expect(narrowed.entered).toEqual(['euros.spec.ts']);
      expect(narrowed.whole).toEqual([]);
    });
  });

  it('declares nothing missing when the run declares no heads', async () => {
    await inRoot(async (root) => {
      const stitched = await stitchJourneys({
        directory: resolve(root, 'never-written'),
        heads: [],
        owners: new Map([[mintJourney(), 'unit.spec.ts']]),
      });
      expect(stitched).toMatchObject({ complete: true, silent: [], unclaimed: 0 });
      expect(stitched.heads.size).toBe(0);
      expect(stitched.because).toBeUndefined();
    });
  });
});

describe('a process nobody asked to report', () => {
  it('installs nothing and runs the body as itself', () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, '__VA__');
    const collector = collectJourneys({ head: 'api', directory: undefined });
    expect(collector.collecting).toBe(false);
    expect(collector.enter(mintJourney(), () => 41 + 1)).toBe(42);
    expect(Object.getOwnPropertyDescriptor(globalThis, '__VA__')).toEqual(before);
  });

  it('lets the page collector defer to a head that is already collecting', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      const collector = collectJourneys({ head: 'api', directory });
      // The build hoists the page collector in front of every instrumented
      // module; in a service it arrives after the head installed its own.
      new Function(executionCollectorSource())();
      const parts = await head(root);
      const journey = mintJourney();
      await collector.enter(journey, () => parts.currency('de'));
      collector.close();

      const reports = await readJourneyReports(directory);
      expect(reports.some((report) => report.journey === journey)).toBe(true);
    });
  });
});

describe('the wire', () => {
  it('finds the journey among the cookies an application already sets', () => {
    expect(journeyOf(`theme=dark; ${JOURNEY_COOKIE}=abc-123; session=xyz`)).toBe('abc-123');
    expect(journeyOf(`${JOURNEY_COOKIE}=abc-123`)).toBe('abc-123');
    expect(journeyOf('theme=dark')).toBeUndefined();
    expect(journeyOf(`${JOURNEY_COOKIE}=`)).toBeUndefined();
    expect(journeyOf(undefined)).toBeUndefined();
    // A cookie whose name merely ends the same way is a different cookie.
    expect(journeyOf(`x-${JOURNEY_COOKIE}=abc-123`)).toBeUndefined();
  });

  it('mints an id that carries no subject name', () => {
    expect(mintJourney()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(mintJourney()).not.toBe(mintJourney());
  });

  it('counts traffic the run did not drive rather than attributing it', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      const collector = collectJourneys({ head: 'api', directory });
      const parts = await head(root);
      await collector.enter('a-journey-nobody-minted', () => parts.currency('de'));
      collector.close();

      const stitched = await stitchJourneys({ directory, heads: ['api'], owners: new Map() });
      expect(stitched.unclaimed).toBe(1);
      expect(stitched.heads.get('api')).toEqual([]);
    });
  });
});

describe('two heads over one file', () => {
  it('add their crossings together rather than retiring each other', async () => {
    // Two builds of overlapping source is the arrangement item 7 of the spec is
    // afraid of: one coverage index, modules keyed by file, and a separate
    // inventory per head. The instrument is a pure function of the source, so
    // the block sets agree and the merge unions them — which is the whole of
    // why one index can hold both.
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      const api = collectJourneys({ head: 'api', directory });
      const apiParts = await head(root, 'api');
      const german = mintJourney();
      await api.enter(german, () => apiParts.currency('de'));
      api.close();

      const worker = collectJourneys({ head: 'worker', directory });
      const workerParts = await head(root, 'worker');
      const english = mintJourney();
      await worker.enter(english, () => workerParts.currency('en'));
      worker.close();

      const coverageFile = resolve(root, 'coverage.bin');
      const stitched = await stitchJourneys({
        directory,
        heads: ['api', 'worker'],
        owners: new Map([
          [german, 'euros.spec.ts'],
          [english, 'dollars.spec.ts'],
        ]),
      });
      expect(stitched.complete).toBe(true);

      // One call. A second one naming these subjects would read as a second
      // run and retire what the first wrote, so the heads are joined into one
      // observation and both inventories are read for it.
      const recorded = await recordExecution({
        root,
        modulesFile: [apiParts.modulesFile, workerParts.modulesFile],
        coverageFile,
        subjects: joinObservations([...stitched.heads.values()]),
      });
      expect(recorded.recorded).toBe(true);

      // The second head did not take the first one's line.
      expect(await selectTestFiles(coverageFile, diffAt('currency.js', EURO_LINE))).toEqual([
        'euros.spec.ts',
      ]);
      expect(await selectTestFiles(coverageFile, diffAt('currency.js', DOLLAR_LINE))).toEqual([
        'dollars.spec.ts',
      ]);
    });
  });
});

describe('one environment block configures both ends', () => {
  it('takes the head name and the report directory from the environment', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'journeys');
      process.env[JOURNEY_HEAD_VARIABLE] = 'api';
      process.env[JOURNEY_DIRECTORY_VARIABLE] = directory;
      try {
        const collector = collectJourneys();
        expect(collector.collecting).toBe(true);
        expect(collector.head).toBe('api');
        const parts = await head(root);
        const journey = mintJourney();
        await collector.enter(journey, () => parts.currency('de'));
        collector.close();

        const reports = await readJourneyReports(directory);
        expect(reports.map((report) => report.head)).toContain('api');
      } finally {
        delete process.env[JOURNEY_HEAD_VARIABLE];
        delete process.env[JOURNEY_DIRECTORY_VARIABLE];
      }
    });
  });
});
