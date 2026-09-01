/**
 * The driver's side of a journey: what a head reported, and which subject it was.
 *
 * Split from [`journey.ts`](./journey.ts) because the two halves never run in
 * the same process. A head holds counts and reports them; only the driver holds
 * `journey -> subject`, so only the driver can join, and it is also the only
 * participant that writes anything down. Nothing crosses a wire to make the join
 * possible — the id already crossed, which is the whole design.
 */

import { INSTRUMENTATION_ID } from '../instrument/index.js';
import { codeUnitOrder } from './instrumented-modules.js';
import type { CoveragePrecondition } from './index.js';
import type { ObservedSubject } from './journal.js';
import type { ExecutedModule } from './probes.js';

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
export const UNATTRIBUTED = '\u0000unattributed';

/** One head's account of one journey, as it leaves the head. */
export interface JourneyAccount {
  readonly version: 1;
  readonly instrumentation: string;
  readonly head: string;
  /**
   * Whether these crossings belong to the execution this was reported under, or
   * to the process that served it. A module's own initialization runs once,
   * before any request, so it belongs to every subject and to no journey.
   */
  readonly scope: 'journey' | 'process';
  /**
   * Accounts this head could not deliver, so far.
   *
   * Carried on later accounts rather than announced on its own, because the
   * report that would announce it travels the same way as the one that was lost.
   * A head that lost every account is simply silent, which retires the run for
   * the same reason and by the same path.
   */
  readonly lost?: number;
  readonly modules: readonly ExecutedModule[];
}

/** One account, once the driver has said which execution it arrived on. */
export interface JourneyReport extends JourneyAccount {
  readonly journey: string;
}

export interface StitchJourneysOptions {
  /**
   * Every account this run was told, as {@link journeyReportFrom} read them.
   *
   * Empty is not an error and not an empty run: it means no head reported, which
   * is the same fact as a head that could not, and is answered the same way.
   */
  readonly reports: readonly JourneyReport[];
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
export function stitchJourneys(options: StitchJourneysOptions): StitchedJourneys {
  const reports = options.reports;
  const reported = new Set(reports.map((report) => report.head));
  const silent = options.heads.filter((head) => !reported.has(head));
  const foreign = reports.find((report) => report.instrumentation !== INSTRUMENTATION_ID);
  const dropped = reports.reduce((most, report) => Math.max(most, report.lost ?? 0), 0);

  const because =
    foreign !== undefined
      ? `head ${foreign.head} reported probe recipe ${foreign.instrumentation} and this driver ` +
        `records ${INSTRUMENTATION_ID}: the service and the driver are different versions`
      : silent.length > 0
        ? `${silent.length === 1 ? 'head' : 'heads'} ${silent.join(', ')} reported nothing: a ` +
          'service that was not watched cannot be told from one that executed nothing, so no ' +
          'subject in this run may justify an exclusion'
        : dropped > 0
          ? `${dropped} ${dropped === 1 ? 'account' : 'accounts'} never reached this driver, so ` +
            'some subject entered code nothing here can name and no subject in this run may ' +
            'justify an exclusion'
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
 * One account, addressed to the execution it arrived on.
 *
 * The execution comes from the driver's side of the wire and never from the
 * body, so a head cannot claim a journey by writing one down — it answers on the
 * address it was given, and that address is the claim. A body this version does
 * not understand is dropped rather than guessed at.
 */
export function journeyReportFrom(journey: string, body: unknown): JourneyReport | undefined {
  const account = body as JourneyAccount | null;
  if (account === null || typeof account !== 'object' || account.version !== 1) return undefined;
  return { ...account, journey: account.scope === 'process' ? UNATTRIBUTED : journey };
}
