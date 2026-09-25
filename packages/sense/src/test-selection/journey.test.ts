import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import journals from './journal-format.cjs';
import { executionCollectorSource, testSelectionProbes } from './probes.js';
import { joinObservations, recordExecution } from './journal.js';
import {
  JOURNEY_COOKIE,
  JOURNEY_HEAD_VARIABLE,
  JOURNEY_VARIABLE,
  collectJourneys,
  journeyOf,
  journeyReportFrom,
  mintJourney,
  stitchJourneys,
  unsettledScopes,
  type JourneyTrace,
} from './journey.js';
import { selectTestFiles } from './index.js';
import { INSTRUMENTATION_ID } from '../instrument/index.js';
import {
  DOLLAR_LINE,
  EURO_LINE,
  LAZY,
  LAZY_DOLLAR_LINE,
  LAZY_EURO_LINE,
  type Currency,
  diffAt,
  evaluate,
  driver,
  forget,
  head,
  inRoot,
  record,
  until,
} from './__fixtures__/journey-head.js';

afterEach(forget);


describe('a head reports what each journey entered', () => {
  it('keeps two journeys apart while they interleave inside one module', async () => {
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);
      const german = mintJourney();
      const english = mintJourney();

      // Both start before either finishes: `currency('de')` runs to its await,
      // yields, and `currency('en')` enters the same module underneath it.
      const [first, second] = await Promise.all([
        collector.enter(driven.carrying(german), () => parts.currency('de')),
        collector.enter(driven.carrying(english), () => parts.currency('en')),
      ]);
      await collector.close();
      expect([first, second]).toEqual(['1200 euros', '1200 dollars']);

      const { stitched, recorded } = await record(root, parts, driven, [
        [german, 'euros.spec.ts'],
        [english, 'dollars.spec.ts'],
      ]);
      expect(stitched).toMatchObject({ complete: true, silent: [], unclaimed: 0 });
      expect(recorded).toMatchObject({ recorded: true, subjects: 2 });

      expect(await selectTestFiles(parts.where.coverageFile, diffAt('currency.js', EURO_LINE))).toEqual([
        'euros.spec.ts',
      ]);
      expect(await selectTestFiles(parts.where.coverageFile, diffAt('currency.js', DOLLAR_LINE))).toEqual(
        ['dollars.spec.ts'],
      );
    });
  });

  it('gives both subjects both branches when the same run carries no journey', async () => {
    // The control, and the reason the case above is evidence rather than a
    // coincidence: identical source, identical interleaving, one counter set.
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);

      await Promise.all([
        collector.enter(undefined, () => parts.currency('de')),
        collector.enter(undefined, () => parts.currency('en')),
      ]);
      // One driven request afterwards, because a process with no way home has
      // nobody to tell. What that request carries is its own account and the
      // process's: its own is empty, and the process's is both branches.
      const german = mintJourney();
      await collector.enter(driven.carrying(german), () => 0);
      await collector.close();

      await record(root, parts, driven, [
        [german, 'euros.spec.ts'],
        [mintJourney(), 'dollars.spec.ts'],
      ]);

      expect(await selectTestFiles(parts.where.coverageFile, diffAt('currency.js', EURO_LINE))).toEqual([
        'dollars.spec.ts',
        'euros.spec.ts',
      ]);
    });
  });

  it('gives what a module did while evaluating inside one journey to every subject', async () => {
    // A service loads a module the first time a request needs it, inside that
    // request's journey; what the top level called, the other subject depends on.
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root, 'build', { source: LAZY, lazy: true });
      const german = mintJourney();
      const english = mintJourney();

      let loaded: Currency | undefined;
      const currency = await collector.enter(driven.carrying(german), () => {
        loaded = evaluate(parts.code);
        return loaded('de');
      });
      expect(currency).toBe('euros');
      await collector.enter(driven.carrying(english), () => loaded!('en'));
      await collector.close();
      await record(root, parts, driven, [
        [german, 'euros.spec.ts'],
        [english, 'dollars.spec.ts'],
      ]);

      expect(await selectTestFiles(parts.where.coverageFile, diffAt('currency.js', LAZY_EURO_LINE))).toEqual([
        'dollars.spec.ts',
        'euros.spec.ts',
      ]);
      expect(await selectTestFiles(parts.where.coverageFile, diffAt('currency.js', LAZY_DOLLAR_LINE))).toEqual([
        'dollars.spec.ts',
      ]);
    });
  });

  it('tells a driver it first hears from late what every subject depended on before it', async () => {
    // Two workers, or a second run against a server the first one started: the
    // module was evaluated under the first driver's journey, and the second
    // driver's subject depends on that initialization all the same.
    await inRoot(async (root) => {
      const first = await driver();
      const second = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root, 'build', { source: LAZY, lazy: true });
      const german = mintJourney();
      const english = mintJourney();

      let loaded: Currency | undefined;
      await collector.enter(first.carrying(german), () => {
        loaded = evaluate(parts.code);
        return loaded('de');
      });
      await collector.enter(second.carrying(english), () => loaded!('en'));
      await collector.close();
      const initialized = first.reports.flatMap((report) => report.modules.flatMap((module) => module.shared));
      expect(initialized.length).toBeGreaterThan(0);

      const { stitched } = await record(root, parts, second, [[english, 'dollars.spec.ts']]);
      const [dollars] = stitched.heads.get('api')!;
      expect(dollars!.journal.modules[0]!.hits).toEqual(expect.arrayContaining(initialized));
      expect(await selectTestFiles(parts.where.coverageFile, diffAt('currency.js', LAZY_EURO_LINE))).toEqual([
        'dollars.spec.ts',
      ]);
    });
  });

  it('sends home what a promise the handler started and did not return entered', async () => {
    // A write behind, an analytics call, a cache warmed after the response: the
    // request's context carries it, and the scope it ran in has already reported.
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);
      const german = mintJourney();
      let behind: Promise<string> | undefined;

      const answered = collector.enter(driven.carrying(german), () => {
        behind = new Promise((resume) => setTimeout(resume, 20)).then(() => parts.currency('de'));
        return 'accepted';
      });
      expect(answered).toBe('accepted');
      await behind;
      await until(
        () =>
          driven.reports.some((report) => report.journey === german && report.modules.length > 0) &&
          unsettledScopes(driven.reports).size === 0,
      );
      await collector.close();

      const { stitched } = await record(root, parts, driven, [
        [german, 'euros.spec.ts'],
        [mintJourney(), 'dollars.spec.ts'],
      ]);
      expect(stitched).toMatchObject({ complete: true });
      expect(await selectTestFiles(parts.where.coverageFile, diffAt('currency.js', EURO_LINE))).toEqual([
        'euros.spec.ts',
      ]);
    });
  });

  it('attributes a scope to the journey until what it returned settles', async () => {
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);
      const journey = mintJourney();
      await collector.enter(driven.carrying(journey), () => parts.currency('de'));
      await collector.close();

      const reports = driven.reports;
      const mine = reports.filter((report) => report.journey === journey && report.opened === undefined);
      expect(mine).toHaveLength(1);
      // Not just the entry block: the resume block after the `await` is in here
      // too, and a drain at the request boundary is what loses it.
      expect(mine[0]!.modules[0]!.hits.length).toBeGreaterThan(1);
      expect(mine[0]!.head).toBe('api');
      expect(mine[0]!.settled).toBe(1);
    });
  });

  it('says a request is open before it settles, so a driver can wait for its account', async () => {
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);
      const journey = mintJourney();
      let respond = (): void => {};
      const tail = new Promise<void>((settle) => (respond = settle));

      // The response is long gone by the time this settles, which is the shape
      // of a streamed body or a write behind.
      const serving = collector.enter(driven.carrying(journey), async () => {
        await tail;
        return parts.currency('de');
      });
      await until(() => unsettledScopes(driven.reports).get('api') === 1);

      respond();
      await serving;
      await until(() => unsettledScopes(driven.reports).size === 0);
      const [account] = driven.reports.filter((report) => report.settled === 1);
      expect(account?.modules.length).toBeGreaterThan(0);
      await collector.close();
    });
  });

  it('closes a request that entered nothing, since the driver cannot tell nothing from not yet', async () => {
    await inRoot(async () => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      await collector.enter(driven.carrying(mintJourney()), () => undefined);
      await collector.flush();
      await until(() => driven.reports.some((report) => report.settled === 1));

      expect(unsettledScopes(driven.reports).size).toBe(0);
      await collector.close();
    });
  });
});

describe('a head that was not there', () => {
  it('refuses the run when a request it said it was serving never reported', () => {
    const journey = mintJourney();
    const notice = { version: 1, instrumentation: INSTRUMENTATION_ID, head: 'api', scope: 'journey', opened: 1, modules: [] };
    const stitched = stitchJourneys({
      reports: [journeyReportFrom(journey, notice)!],
      heads: ['api'],
      owners: new Map([[journey, 'euros.spec.ts']]),
    });
    expect(stitched.complete).toBe(false);
    expect(stitched.because).toContain('head api had 1 request still running');
  });

  it('refuses to let any subject in the run justify an exclusion', async () => {
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);
      const journey = mintJourney();
      await collector.enter(driven.carrying(journey), () => parts.currency('de'));
      await collector.close();

      const stitched = stitchJourneys({
        reports: driven.reports,
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
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);
      const journey = mintJourney();
      await collector.enter(driven.carrying(journey), () => parts.currency('de'));
      await collector.close();

      const stitched = stitchJourneys({
        reports: driven.reports,
        heads: ['api', 'pricing'],
        owners: new Map([[journey, 'euros.spec.ts']]),
      });
      await recordExecution({
        root,
        ...parts.where,
        subjects: stitched.heads.get('api')!,
      });

      const { narrowByExecution } = await import('./index.js');
      const narrowed = await narrowByExecution(
        parts.where.coverageFile,
        diffAt('currency.js', EURO_LINE),
      );
      // The crossings are there — the subject entered the changed line — and the
      // ground still may not spend them, because `whole` is what it skips from.
      expect(narrowed.entered).toEqual(['euros.spec.ts']);
      expect(narrowed.whole).toEqual([]);
    });
  });

  it('declares nothing missing when the run declares no heads', () => {
    const stitched = stitchJourneys({
      reports: [],
      heads: [],
      owners: new Map([[mintJourney(), 'unit.spec.ts']]),
    });
    expect(stitched).toMatchObject({ complete: true, silent: [], unclaimed: 0 });
    expect(stitched.heads.size).toBe(0);
    expect(stitched.because).toBeUndefined();
  });
});

describe('a process nobody asked to report', () => {
  it('installs nothing and runs the body as itself', () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, '__VA__');
    const collector = collectJourneys({ head: 'api', enabled: false });
    expect(collector.collecting).toBe(false);
    expect(collector.enter(`${JOURNEY_COOKIE}=${mintJourney()}`, () => 41 + 1)).toBe(42);
    expect(Object.getOwnPropertyDescriptor(globalThis, '__VA__')).toEqual(before);
  });

  it('lets the page collector defer to a head that is already collecting', async () => {
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      // The build hoists the page collector in front of every instrumented
      // module; in a service it arrives after the head installed its own.
      new Function(executionCollectorSource())();
      const parts = await head(root);
      const journey = mintJourney();
      await collector.enter(driven.carrying(journey), () => parts.currency('de'));
      await collector.close();

      const reports = driven.reports;
      expect(reports.some((report) => report.journey === journey)).toBe(true);
    });
  });
});

describe('a realm holds one head', () => {
  it('hands the installed head to a second call until it closes', async () => {
    const first = collectJourneys({ head: 'build', enabled: true });
    try {
      const second = collectJourneys({ head: 'service', enabled: true });
      expect(second).toBe(first);
      expect(second.head).toBe('build');
    } finally {
      await first.close();
    }
    const after = collectJourneys({ head: 'service', enabled: true });
    try {
      expect(after).not.toBe(first);
      expect(after.head).toBe('service');
    } finally {
      await after.close();
    }
  });

  it('installs the head ahead of the page collector when the build asks', async () => {
    await inRoot(async (root) => {
      const collector = '\0variance-authority:execution-collector';
      const source = testSelectionProbes({ root, label: 'workers', journeys: true }).load(collector);
      expect(source).toBe(
        'import { collectJourneys } from "@variance-authority/sense/journey";\n' +
          'collectJourneys({"head":"workers"});\n' +
          executionCollectorSource(),
      );
      expect(testSelectionProbes({ root, label: 'workers' }).load(collector)).toBe(executionCollectorSource());
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
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);
      await collector.enter(driven.carrying('a-journey-nobody-minted'), () => parts.currency('de'));
      await collector.close();

      const stitched = stitchJourneys({
        reports: driven.reports,
        heads: ['api'],
        owners: new Map(),
      });
      expect(stitched.unclaimed).toBe(1);
      expect(stitched.heads.get('api')).toEqual([]);
    });
  });
});

describe('two heads over one file', () => {
  it('add their crossings together rather than retiring each other', async () => {
    // Two builds of overlapping source is the arrangement item 7 of the spec is
    // afraid of: one coverage index, modules keyed by file, and a separate
    // store per head. The instrument is a pure function of the source, so the
    // block sets agree and the merge unions them — which is the whole of why
    // one index can hold both.
    await inRoot(async (root) => {
      const driven = await driver();
      const api = collectJourneys({ head: 'api', enabled: true });
      const apiParts = await head(root, 'api');
      const german = mintJourney();
      await api.enter(driven.carrying(german), () => apiParts.currency('de'));
      await api.close();

      const worker = collectJourneys({ head: 'worker', enabled: true });
      const workerParts = await head(root, 'worker');
      const english = mintJourney();
      await worker.enter(driven.carrying(english), () => workerParts.currency('en'));
      await worker.close();

      const coverageFile = resolve(root, 'coverage.bin');
      const stitched = stitchJourneys({
        reports: driven.reports,
        heads: ['api', 'worker'],
        owners: new Map([
          [german, 'euros.spec.ts'],
          [english, 'dollars.spec.ts'],
        ]),
      });
      expect(stitched.complete).toBe(true);

      // One call. A second one naming these subjects would read as a second
      // run and retire what the first wrote, so the heads are joined into one
      // observation and both stores are read for it.
      const recorded = await recordExecution({
        root,
        ...apiParts.where,
        heads: [workerParts.where.label],
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
  it('takes the head name and the fact of the run from the environment', async () => {
    await inRoot(async (root) => {
      const driven = await driver();
      process.env[JOURNEY_HEAD_VARIABLE] = 'api';
      process.env[JOURNEY_VARIABLE] = '1';
      try {
        const collector = collectJourneys();
        expect(collector.collecting).toBe(true);
        expect(collector.head).toBe('api');
        const parts = await head(root);
        const journey = mintJourney();
        await collector.enter(driven.carrying(journey), () => parts.currency('de'));
        await collector.close();

        const reports = driven.reports;
        expect(reports.map((report) => report.head)).toContain('api');
      } finally {
        delete process.env[JOURNEY_HEAD_VARIABLE];
        delete process.env[JOURNEY_VARIABLE];
      }
    });
  });
});

describe('a head told which trace is running', () => {
  /** A tracer whose running trace is whatever the test last set. */
  const tracer = (): JourneyTrace & { running: string | undefined; asked: number } => {
    const trace = {
      name: 'tracer',
      running: undefined as string | undefined,
      asked: 0,
      carry: <Result,>(_journey: string, _name: string, body: () => Result): Result => body(),
      current: () => {
        trace.asked += 1;
        return trace.running;
      },
    };
    return trace;
  };

  /** Regions entered per journey across a directory of parts. */
  const partsIn = async (directory: string): Promise<Map<string, number>> => {
    const journeys = new Map<string, number>();
    for (const name of await readdir(directory)) {
      const bytes = await readFile(resolve(directory, name));
      for (let at = 0; at < bytes.length;) {
        const length = bytes.readUInt32LE(at);
        const frame = journals.decodeJournal(bytes.subarray(at + 4, at + 4 + length));
        at += 4 + length;
        const hits = frame.modules.reduce((sum, module) => sum + module.hits.length, 0);
        const journey = journals.journeyOf(frame.testFile);
        journeys.set(journey, (journeys.get(journey) ?? 0) + hits);
      }
    }
    return journeys;
  };

  it('asks the trace wherever enter did not say, after a build installed it untold', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'parts');
      // What a build installs at global scope, before the application has
      // initialized its tracing.
      const installed = collectJourneys({ head: 'api', parts: directory });
      const trace = tracer();
      expect(collectJourneys({ trace })).toBe(installed);
      const parts = await head(root);

      trace.running = 'a'.repeat(32);
      parts.currency('de');
      trace.running = 'b'.repeat(32);
      parts.currency('en');
      await installed.close();

      expect(trace.asked).toBeGreaterThan(0);
      const journeys = await partsIn(directory);
      expect([...journeys.keys()].filter((journey) => journey !== '').sort()).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
      expect(journeys.get('a'.repeat(32))).toBeGreaterThan(0);
      expect(journeys.get('b'.repeat(32))).toBeGreaterThan(0);
    });
  });

  it('lets the journey enter names outrank the trace', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'parts');
      const trace = tracer();
      const collector = collectJourneys({ head: 'api', parts: directory, trace });
      const parts = await head(root);
      trace.running = 'c'.repeat(32);
      await collector.enter(`${JOURNEY_COOKIE}=${'d'.repeat(32)}`, () => parts.currency('de'));
      await collector.close();

      const journeys = await partsIn(directory);
      expect(journeys.get('d'.repeat(32))).toBeGreaterThan(0);
      expect(journeys.has('c'.repeat(32))).toBe(false);
    });
  });

  it('refuses a trace for a head that reports home, since a trace carries no way back', async () => {
    const trace = tracer();
    expect(() => collectJourneys({ head: 'api', enabled: true, trace })).toThrow(
      'a tracer trace carries the journey and no way home',
    );
    const installed = collectJourneys({ head: 'api', enabled: true });
    try {
      expect(() => collectJourneys({ trace })).toThrow('a tracer trace carries the journey and no way home');
    } finally {
      await installed.close();
    }
  });
});
