/**
 * A head under test: an instrumented module a service would load, a driver
 * listening where its accounts return, and the stitch that joins the two.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RETURN_COOKIE } from '@variance-authority/wire';
import { listen, type Wire } from '@variance-authority/wire/listen';
import { recordExecution } from '../journal.js';
import { JOURNEY_COOKIE, journeyReportFrom, stitchJourneys, type JourneyReport } from '../journey.js';
import { testSelectionProbes } from '../probes.js';

/**
 * A module that decides, then awaits, then decides again.
 *
 * The `await` is the whole point. Everything after it is instrumented too, so
 * two callers overlap inside one module rather than merely following each other
 * through it — which is the only arrangement under which a shared counter set
 * gives a crossing to the wrong subject.
 */
export const SOURCE = [
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

export const EURO_LINE = 6;
export const DOLLAR_LINE = 8;

/** A module whose top level calls a helper once, the moment it is first needed. */
export const LAZY = [
  'function label(locale) {',
  '  if (locale === "de") return "euros";',
  '  return "dollars";',
  '}',
  'globalThis.__head_test_default = label("de");',
  'globalThis.__head_test_currency = async (locale) => label(locale);',
].join('\n');

export const LAZY_EURO_LINE = 2;
export const LAZY_DOLLAR_LINE = 3;

export type Currency = (locale: string) => Promise<string>;
const unevaluated: Currency = () => Promise.reject(new Error('the module has not been evaluated'));

/** Evaluate the transformed module the way a service's loader would. */
export function evaluate(transformed: string): Currency {
  new Function(transformed.replace(/^import "[^"]+";/, ''))();
  return (globalThis as unknown as Record<string, unknown>)['__head_test_currency'] as Currency;
}

const listening: Wire[] = [];

/**
 * The collector this file found installed, which is the runner's when the suite
 * is instrumenting itself and nothing at all otherwise.
 *
 * A collector that closes puts back what it displaced. One that a test leaves
 * open has to be put back here, because the process outside these tests is
 * still reporting through the global and the next thing to read it is not a
 * fixture.
 */
const AMBIENT = Object.getOwnPropertyDescriptor(globalThis, '__VA__');

/** Close what a test left listening, and put the ambient collector back. Run after each test. */
export async function forget(): Promise<void> {
  for (const wire of listening.splice(0)) await wire.close();
  const global = globalThis as unknown as Record<string, unknown>;
  delete global['__head_test_currency'];
  if (AMBIENT === undefined) delete global['__VA__'];
  else Object.defineProperty(globalThis, '__VA__', AMBIENT);
}

/** What a head answers to, and everything it has said so far. */
export interface Driver {
  readonly reports: JourneyReport[];
  /** The `Cookie` header a request driven by this journey carries. */
  readonly carrying: (journey: string) => string;
}

export async function driver(): Promise<Driver> {
  const reports: JourneyReport[] = [];
  const wire = await listen();
  listening.push(wire);
  wire.on('journeys', (journey, body) => {
    const report = journey === undefined ? undefined : journeyReportFrom(journey, body);
    if (report !== undefined) reports.push(report);
  });
  return {
    reports,
    carrying: (journey) =>
      `theme=dark; ${JOURNEY_COOKIE}=${journey}; ${RETURN_COOKIE}=${wire.addressFor(journey)}`,
  };
}

export async function inRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-journey-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function diffAt(file: string, line: number): string {
  return `--- a/${file}\n+++ b/${file}\n@@ -${line},1 +${line},1 @@\n`;
}

/** Stitch what the driver heard to its owners, and record the `api` head's part. */
export async function record(
  root: string,
  parts: Head,
  driven: Driver,
  owners: readonly (readonly [string, string])[],
): Promise<{ stitched: ReturnType<typeof stitchJourneys>; recorded: Awaited<ReturnType<typeof recordExecution>> }> {
  const stitched = stitchJourneys({ reports: driven.reports, heads: ['api'], owners: new Map(owners) });
  const recorded = await recordExecution({
    root,
    ...parts.where,
    subjects: stitched.heads.get('api')!,
  });
  return { stitched, recorded };
}

type HeadOptions = { readonly source?: string; readonly lazy?: boolean };

export interface Head {
  /** What `recordExecution` needs to find this head's records and its index. */
  readonly where: { readonly cacheRoot: string; readonly label: string; readonly coverageFile: string };
  readonly currency: Currency;
  readonly code: string;
}

/**
 * Instrument the module, install the collector, and evaluate — in that order.
 * `lazy` leaves it unevaluated, for a test that loads it inside a journey.
 */
export async function head(root: string, label = 'build', options: HeadOptions = {}): Promise<Head> {
  const source = options.source ?? SOURCE;
  const cacheRoot = resolve(root, 'cache');
  const module = resolve(root, 'currency.js');
  await writeFile(module, source, 'utf8');
  const plugin = testSelectionProbes({ root, label, cacheRoot });
  const transformed = plugin.transform.call(
    { getCombinedSourcemap: () => ({ mappings: '', sources: [] }) },
    source,
    module,
  )!;
  return {
    where: { cacheRoot, label, coverageFile: resolve(root, 'coverage.bin') },
    currency: options.lazy ? unevaluated : evaluate(transformed.code),
    code: transformed.code,
  };
}

/** Poll until `done`, which is how a test watches reports that travel over a socket. */
export async function until(done: () => boolean): Promise<void> {
  for (let tries = 0; !done(); tries += 1) {
    if (tries > 200) throw new Error('the reports never arrived');
    await new Promise((settle) => setTimeout(settle, 5));
  }
}
