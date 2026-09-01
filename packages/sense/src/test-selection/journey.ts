/**
 * `@variance-authority/sense/journey` — the same instrument in a process that is
 * not a realm.
 *
 * [`journal.ts`](./journal.ts) next door carries the instrument into a browser:
 * one page, one subject at a time, torn down between them, so a counter array
 * needs no key and the driver reads it back through `page.evaluate`. A service
 * is neither of those things. It outlives every subject in the run, it answers
 * several of them at once, and nobody can evaluate inside it. One counter set in
 * a server process is shared mutable state across concurrent logical flows, and
 * draining it at request boundaries does not rescue it — a streamed response
 * flushes after its handler returned, a floating promise settles two requests
 * later, and a time window is not a journey. The crossing goes to whoever was
 * open at that moment; the subject that caused it loses it, and the next diff to
 * land there skips that subject without a word.
 *
 * So the scope is logical, which in Node means async context, and the key on the
 * wire is a **journey**: one opaque id per execution of one subject, minted by
 * the driver, carried by a cookie, read back by whatever the head already has.
 * This is distributed tracing in the vocabulary this repository already uses —
 * the driver is one participant among several, each reports what it entered
 * under the id, and the join happens afterwards on the id alone. The subject's
 * *name* never leaves the driver.
 *
 * Three parts, and each is somebody's:
 *
 * 1. **The head** ({@link collectJourneys}) runs inside the service. It installs
 *    a journey-keyed factory behind `globalThis.__VA__` and writes one report per
 *    journey into a directory it is told about. Told nothing, it installs
 *    nothing: the same call ships to production and costs an `if`.
 * 2. **The wire** ({@link JOURNEY_COOKIE}, {@link mintJourney},
 *    {@link journeyOf}) is a cookie holding a UUID. Same-origin is the filter,
 *    the browser enforces it, cookies ignore ports, and a bare UUID has no
 *    character any engine encodes differently.
 * 3. **The join** ({@link stitchJourneys}) runs in the driver, which is the only
 *    participant that knows which subject each journey was.
 *
 * ## The probe does not change, and this is why
 *
 * The emitted probe re-resolves its counter array whenever the factory's
 * identity moves ([`instrument`](../instrument/index.ts)) — written for realm
 * reuse, and exactly right here. `globalThis.__VA__` is defined as a **getter**
 * over the async store, handing back a distinct factory per journey, so the
 * probe's own cache invalidates for free at precisely the crossings where two
 * journeys interleave inside one module, and nowhere else. Swapping a plain
 * global at the request boundary instead is the shape that reads correctly under
 * one request at a time and silently misattributes under load.
 *
 * ## A head that was not there
 *
 * Every head a run declares must report at least once. A service that failed to
 * start, was built without probes, or was never wired contributes no crossings
 * at all — and absence is what the journey ground already reads as *unknown*.
 * The distinction this file exists to keep is between *the head executed
 * nothing* and *the head was not watched*, and one report anywhere in the run
 * settles it. Silence does not narrow: it retires every observation in the run,
 * so the ground declines wholesale rather than skipping subjects on evidence
 * half of which never arrived.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { INSTRUMENTATION_ID } from '../instrument/index.js';
import { codeUnitOrder, isMissing } from './instrumented-modules.js';
import type { CoveragePrecondition } from './index.js';
import type { ObservedSubject } from './journal.js';
import type { ExecutedModule } from './probes.js';

/**
 * The cookie a journey rides on.
 *
 * Deliberately not a short name, for the reason `EXECUTION_GLOBAL` is not: this
 * shares a namespace with whatever the application already sets, and a collision
 * would surface as a confusing selection rather than as an error.
 */
export const JOURNEY_COOKIE = 'variance-authority-journey';

/** Where a head reports. Absent, a head installs nothing. */
export const JOURNEY_DIRECTORY_VARIABLE = 'VARIANCE_AUTHORITY_JOURNEYS';

/** What a head calls itself, when the process is started rather than configured. */
export const JOURNEY_HEAD_VARIABLE = 'VARIANCE_AUTHORITY_HEAD';

/**
 * Crossings that belong to no journey, and the name they report under.
 *
 * A module's own initialization runs once per process, before any request, so
 * every journey depends on it and none records it. The same is true of a
 * background timer and of anything a handler left running past its scope. Those
 * are folded into **every** subject by {@link stitchJourneys} — over-including,
 * in the direction [`selecting.md`](../../../../docs/selecting.md) argues for,
 * rather than pretending a process can name a caller it never had. The leading
 * space keeps it out of the space a driver mints from: a UUID has none.
 */
const UNATTRIBUTED = '\u0000unattributed';

/** One execution of one subject, as it crosses the wire: opaque, and nothing else. */
export function mintJourney(): string {
  return randomUUID();
}

/**
 * Read a journey back out of a `Cookie` header.
 *
 * The header is the one place a head is guaranteed to have, whatever framework
 * sits above it. A head with a request-scoped cookie accessor of its own should
 * use that and pass the value straight to {@link JourneyCollector.enter}.
 */
export function journeyOf(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    if (pair.slice(0, equals).trim() !== JOURNEY_COOKIE) continue;
    const value = pair.slice(equals + 1).trim();
    return value.length === 0 ? undefined : value;
  }
  return undefined;
}

export interface JourneyCollectorOptions {
  /**
   * What this head calls itself. Defaults to {@link JOURNEY_HEAD_VARIABLE}, then
   * `head`. It is the `label` its build gave `testSelectionProbes()`: an ordinal
   * means something only against the inventory that minted it.
   */
  readonly head?: string;
  /**
   * Where reports are written. Defaults to {@link JOURNEY_DIRECTORY_VARIABLE}.
   * Absent, nothing is installed and {@link JourneyCollector.enter} is the
   * identity — which is how this call survives being left in a production build.
   */
  readonly directory?: string;
}

/** A head's participation in a run, or its cheap absence. */
export interface JourneyCollector {
  /** False when no directory was configured: nothing installed, nothing written. */
  readonly collecting: boolean;
  readonly head: string;
  /**
   * Run `body` as part of `journey`, so everything it enters — including
   * whatever it awaits — is attributed to that subject and to no other.
   *
   * `undefined` is honest and is not an error: a request with no cookie is
   * something the run did not drive, and its crossings go to the unattributed
   * bucket rather than to whichever subject happened to be nearby.
   */
  readonly enter: <Result>(journey: string | undefined, body: () => Result) => Result;
  /** Write out everything held so far, including crossings still inside open scopes. */
  readonly flush: () => void;
  /** Stop collecting and restore what was on the global before. */
  readonly close: () => void;
}

/** One head's account of one journey, as it lands in the run directory. */
export interface JourneyReport {
  readonly version: 1;
  readonly instrumentation: string;
  readonly head: string;
  readonly journey: string;
  readonly modules: readonly ExecutedModule[];
}

type Factory = (file: string, count: number) => Uint32Array;

/**
 * Install the journey-keyed collector in this process.
 *
 * ```js
 * import { collectJourneys, journeyOf } from '@variance-authority/sense/journey';
 *
 * const journeys = collectJourneys();
 * server.on('request', (request, response) =>
 *   journeys.enter(journeyOf(request.headers.cookie), () => handle(request, response)));
 * ```
 *
 * One line, and it is the whole of the extra setup a service needs — plus
 * forwarding the cookie on any request it makes onward, which is the only way
 * anything past the first hop is ever attributed.
 */
export function collectJourneys(options: JourneyCollectorOptions = {}): JourneyCollector {
  const head = options.head ?? process.env[JOURNEY_HEAD_VARIABLE] ?? 'head';
  const directory = options.directory ?? process.env[JOURNEY_DIRECTORY_VARIABLE];
  if (directory === undefined) {
    return {
      collecting: false,
      head,
      enter: (_journey, body) => body(),
      flush: () => {},
      close: () => {},
    };
  }

  const store = new AsyncLocalStorage<string>();
  const counters = new Map<string, Map<string, Uint32Array>>();
  const factories = new Map<string, Factory>();
  const depth = new Map<string, number>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__VA__');
  let made = false;

  // One factory object per journey, cached: the probe re-resolves exactly when
  // this identity moves, so a fresh closure per increment would be correct and
  // slow, and one shared closure would be neither.
  const factoryFor = (journey: string): Factory => {
    const known = factories.get(journey);
    if (known !== undefined) return known;
    const modules = new Map<string, Uint32Array>();
    counters.set(journey, modules);
    const factory: Factory = (file, count) => {
      let counted = modules.get(file);
      if (counted === undefined || counted.length !== count) {
        counted = new Uint32Array(count);
        modules.set(file, counted);
      }
      return counted;
    };
    factories.set(journey, factory);
    return factory;
  };

  const write = (journey: string): void => {
    const modules = counters.get(journey);
    counters.delete(journey);
    factories.delete(journey);
    if (modules === undefined) return;
    const entered: ExecutedModule[] = [];
    for (const [file, counted] of modules) {
      const hits: number[] = [];
      for (let ordinal = 0; ordinal < counted.length; ordinal += 1) {
        if (counted[ordinal]! > 0) hits.push(ordinal);
      }
      if (hits.length > 0) entered.push({ file, hits });
    }
    if (entered.length === 0) return;
    const report: JourneyReport = {
      version: 1,
      instrumentation: INSTRUMENTATION_ID,
      head,
      journey,
      modules: entered.sort((left, right) => codeUnitOrder(left.file, right.file)),
    };
    if (!made) {
      mkdirSync(directory, { recursive: true });
      made = true;
    }
    // Synchronous, and one file per journey rather than one per process at the
    // end. A driver reads this directory while the service is still serving, and
    // a report that waited for shutdown would be read by nobody: `webServer`
    // teardown happens after the workers that needed it have already recorded.
    writeFileSync(resolve(directory, `${process.pid}-${randomUUID()}.json`), JSON.stringify(report));
  };

  const release = (journey: string): void => {
    const open = (depth.get(journey) ?? 1) - 1;
    if (open > 0) {
      depth.set(journey, open);
      return;
    }
    depth.delete(journey);
    write(journey);
    write(UNATTRIBUTED);
  };

  const flush = (): void => {
    // `write` deletes the key it was handed, which is the one being visited —
    // the only mutation a Map iteration is allowed to see and go on.
    for (const journey of counters.keys()) write(journey);
  };

  Object.defineProperty(globalThis, '__VA__', {
    configurable: true,
    get: () => factoryFor(store.getStore() ?? UNATTRIBUTED),
  });
  process.once('exit', flush);

  return {
    collecting: true,
    head,
    enter: <Result,>(journey: string | undefined, body: () => Result): Result => {
      if (journey === undefined) return body();
      depth.set(journey, (depth.get(journey) ?? 0) + 1);
      let done: Result;
      try {
        done = store.run(journey, body);
      } catch (error) {
        release(journey);
        throw error;
      }
      // A handler's scope ends when what it returned settles, not when it
      // returns: everything after an `await` is instrumented too, and that is
      // the half a request-boundary drain loses.
      if (isThenable(done)) return done.finally(() => release(journey)) as Result;
      release(journey);
      return done;
    },
    flush,
    close: () => {
      flush();
      process.off('exit', flush);
      if (previous === undefined) delete (globalThis as Record<string, unknown>)['__VA__'];
      else Object.defineProperty(globalThis, '__VA__', previous);
    },
  };
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function' &&
    typeof (value as { finally?: unknown }).finally === 'function'
  );
}

export interface StitchJourneysOptions {
  /**
   * The run directory every head was pointed at.
   *
   * Absent is not an error and not an empty run: it means nothing told any head
   * where to report, which is the same fact as a head that did not, and is
   * answered the same way.
   */
  readonly directory?: string;
  /**
   * Every head this run declares, by the name it reports under.
   *
   * Empty is the ordinary case and costs nothing: a Storybook preview or a
   * Vitest file has one process, so it declares no heads and nothing can be
   * missing from it.
   */
  readonly heads: readonly string[];
  /** Which subject each journey the driver minted belonged to. */
  readonly owners: ReadonlyMap<string, string>;
  /** Inputs each subject's observation depended on, by subject. */
  readonly preconditions?: ReadonlyMap<string, readonly CoveragePrecondition[]>;
  /**
   * Subjects the runner already knows did not finish. A failed subject may
   * contribute crossings and may never justify an exclusion.
   */
  readonly incomplete?: ReadonlySet<string>;
}

/** What the reports in a run directory add up to. */
export interface StitchedJourneys {
  /**
   * Each head that reported, and what it saw, keyed by the label its build
   * instrumented under. The labels name the inventories one `recordExecution`
   * reads, because an ordinal means something only against the inventory that
   * minted it, and the rows join the page's rather than being written after
   * them.
   */
  readonly heads: ReadonlyMap<string, readonly ObservedSubject[]>;
  /** Declared heads that reported nothing all run. */
  readonly silent: readonly string[];
  /** Reports for journeys no subject claimed: traffic this run did not drive. */
  readonly unclaimed: number;
  /**
   * False when a declared head was silent or reported against another probe
   * recipe. Every observation in the run is then recorded incomplete, which is
   * what stops a half-watched run from narrowing.
   */
  readonly complete: boolean;
  /** Present when `complete` is false, in the words a report can print. */
  readonly because?: string;
}

/**
 * Join every head's reports to the subjects the driver minted journeys for.
 *
 * The driver is the only participant holding `journey -> subject`, so this runs
 * there and nothing crosses a wire to make it possible. It refuses in one
 * direction only: a declared head that never reported, or one reporting a
 * different probe recipe, retires every observation rather than contributing
 * part of one.
 */
export async function stitchJourneys(options: StitchJourneysOptions): Promise<StitchedJourneys> {
  const reports =
    options.directory === undefined ? [] : await readJourneyReports(options.directory);
  const reported = new Set(reports.map((report) => report.head));
  const silent = options.heads.filter((head) => !reported.has(head));
  const foreign = reports.find((report) => report.instrumentation !== INSTRUMENTATION_ID);

  const because =
    foreign !== undefined
      ? `head ${foreign.head} reported probe recipe ${foreign.instrumentation} and this driver ` +
        `records ${INSTRUMENTATION_ID}: the service and the driver are different versions`
      : silent.length > 0
        ? `${silent.length === 1 ? 'head' : 'heads'} ${silent.join(', ')} reported nothing: a ` +
          'service that was not watched cannot be told from one that executed nothing, so no ' +
          'subject in this run may justify an exclusion'
        : undefined;
  const complete = because === undefined;

  // Everything a process did outside any journey is everybody's: it ran, it is
  // product source, and no subject can be excluded on the claim that it did not.
  const shared = new Map<string, Map<string, Set<number>>>();
  const held = new Map<string, Map<string, Map<string, Set<number>>>>();
  let unclaimed = 0;

  for (const report of reports) {
    if (report.journey === UNATTRIBUTED) {
      const common = shared.get(report.head) ?? new Map<string, Set<number>>();
      add(common, report.modules);
      shared.set(report.head, common);
      continue;
    }
    const owner = options.owners.get(report.journey);
    if (owner === undefined) {
      unclaimed += 1;
      continue;
    }
    const byOwner = held.get(report.head) ?? new Map<string, Map<string, Set<number>>>();
    const modules = byOwner.get(owner) ?? new Map<string, Set<number>>();
    add(modules, report.modules);
    byOwner.set(owner, modules);
    held.set(report.head, byOwner);
  }

  const everyOwner = [...new Set(options.owners.values())];
  const heads = new Map<string, readonly ObservedSubject[]>();
  for (const head of reported) {
    const byOwner = held.get(head) ?? new Map<string, Map<string, Set<number>>>();
    const common = shared.get(head);
    // A head whose only report was unattributed still saw every subject's shared
    // initialization, so the rows exist even when no journey of its own landed.
    const owners = common === undefined ? [...byOwner.keys()] : everyOwner;
    const subjects: ObservedSubject[] = [];
    for (const owner of [...owners].sort(codeUnitOrder)) {
      const modules = new Map<string, Set<number>>();
      const own = byOwner.get(owner);
      if (own !== undefined) for (const [file, ordinals] of own) modules.set(file, new Set(ordinals));
      if (common !== undefined) {
        for (const [file, ordinals] of common) {
          const into = modules.get(file) ?? new Set<number>();
          for (const ordinal of ordinals) into.add(ordinal);
          modules.set(file, into);
        }
      }
      if (modules.size === 0) continue;
      const preconditions = options.preconditions?.get(owner);
      subjects.push({
        owner,
        complete: complete && options.incomplete?.has(owner) !== true,
        journal: {
          instrumentation: INSTRUMENTATION_ID,
          modules: [...modules]
            .map(([file, ordinals]) => ({
              file,
              hits: [...ordinals].sort((left, right) => left - right),
            }))
            .sort((left, right) => codeUnitOrder(left.file, right.file)),
        },
        ...(preconditions === undefined ? {} : { preconditions }),
      });
    }
    heads.set(head, subjects);
  }

  return { heads, silent, unclaimed, complete, ...(because === undefined ? {} : { because }) };
}

function add(into: Map<string, Set<number>>, modules: readonly ExecutedModule[]): void {
  for (const module of modules) {
    const ordinals = into.get(module.file) ?? new Set<number>();
    for (const ordinal of module.hits) ordinals.add(ordinal);
    into.set(module.file, ordinals);
  }
}

/**
 * Every report in a run directory.
 *
 * A missing directory is not an error: it is a run in which no head reported,
 * which is exactly the fact {@link stitchJourneys} is built to act on.
 */
export async function readJourneyReports(directory: string): Promise<readonly JourneyReport[]> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const reports = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(
        async (name) =>
          JSON.parse(await readFile(resolve(directory, name), 'utf8')) as JourneyReport,
      ),
  );
  return reports.filter((report) => report.version === 1);
}
