import { profileById } from '@variance-authority/core';
import { RasterStoreError } from '@variance-authority/raster';
import { DEFAULT_ALONE_LIMIT } from '../config.js';
import { OperatorError } from '../exit.js';
import { matchesGlob, type Plan } from './collector.js';
import { observeOne } from './observe-one.js';
import { recordIfConfigured, type SubjectHistory } from './history.js';
import { ledgerOf } from './ignores.js';
import { sensitivityLedgerOf } from './sensitivities.js';
import { decoderFor } from './resources.js';
import { concurrencyOf, pool, serial } from './schedule.js';
import type { ObserveContext, Outcome, RunOptions } from './run-context.js';
import { shardFilterBecause } from './run-report.js';
import type { CliObservationRecord, CliRunReport, NotObserved } from './run-report.js';

/**
 * `variance run` — collect, decide, and write down what was decided.
 *
 * Two properties of this command are worth more than everything else in it, and
 * both are properties of what it *refuses* to do.
 *
 * **It renders only what the cheaper tiers could not settle.** Rasterization
 * costs ~65ms against ~3.4ms for a semantic collection of the same page
 * (ADR-0010), and a suite is three hundred subjects of which two changed. The
 * lever is content addressing: a `RenderDocument` is a complete statement of what
 * is to be painted, so if the digest of this run's document equals the digest the
 * stored baseline was painted from, *under the same renderer identity*, then
 * repainting it can only reproduce the same image. That is a settlement, not a
 * guess, and it is the argument `settle` makes in `settle.ts`.
 *
 * **It states every subject it did not observe.** Silence about a subject is
 * indistinguishable from a pass, and a suite that quietly stops observing a
 * component is worse than no suite — it is a green check over an unwatched
 * surface. So the report carries a second list beside the observations, every
 * entry of which has a reason, and `exitFor` refuses to say "nothing needs
 * review" while it contains a subject the run meant to see and could not.
 *
 * ## Where the rest of the command is
 *
 * This file is the loop and the renderer's lifetime, and nothing else. Each piece
 * it calls is a file that can be read on its own: `collector.ts` (what to
 * observe, and where documents come from), `settle.ts` (whether a subject needs
 * an image at all), `observe-one.ts` (the decision about one subject),
 * `record.ts` (what the report records), `images.ts` (the bytes `accept` will
 * need), `alone.ts` (regression or leak), `schedule.ts` (how wide, and what may
 * never widen), `resources.ts` (decoder, store, disk) and `run-report.ts` (the
 * artifact's shape and its reader). Every public name any of them exports is
 * re-exported below, so `commands/run.js` is still the one import path.
 */

export { matchesGlob, loadCollector, planList, planStorybook } from './collector.js';
export type {
  Collected,
  Collector,
  CollectorContext,
  Plan,
  PlannedSubject,
  SubjectSource,
} from './collector.js';
export { settle } from '@variance-authority/raster';
export type { Settlement } from '@variance-authority/raster';
export { ledgerOf, liveIgnores, summarizeLedger } from './ignores.js';
export { sensitivityLedgerOf, summarizeSensitivities } from './sensitivities.js';
export type { SensitivityLedger, SensitivityUsage } from './sensitivities.js';
export type { IgnoreLedger, IgnoreUsage } from './ignores.js';
export { recordOf } from './record.js';
export { decoderFor, historyFor, renderCacheRoot, storeFor, writeArtifactToDisk } from './resources.js';
export { readCliRunReport, writeCliRunReport } from './run-report.js';
export type {
  CliObservationRecord,
  CliRunReport,
  NotObserved,
  NotObservedKind,
} from './run-report.js';
export type { RunDeps, RunOptions } from './run-context.js';
export { identityOf } from './history.js';
export type { RunIdentity } from './history.js';

/**
 * Run, and write the report.
 *
 * The loop is deliberately flat and the interesting decisions are all in named
 * functions elsewhere, because this is the place a reader comes to answer "why
 * was my subject not in the output" and that question must be answerable by
 * reading one screen.
 */
export async function run(options: RunOptions): Promise<CliRunReport> {
  const { config, deps } = options;
  const profile = profileById(config.profile);

  const plan = await deps.collector.plan();
  const observations: CliObservationRecord[] = [];
  const notObserved: NotObserved[] = [...plan.notObserved];

  // The profile describes the *collector*, not the renderer. `--profile jsdom`
  // with a renderer is the sub-renderer split document.ts route 1 exists for: the
  // cheap tier decides almost everything and hands the residue to something that
  // owns a GPU. What it costs is stated here rather than discovered from a report
  // full of coordinates with no names — attribution joins regions to boxes, and a
  // profile with no layout engine has no boxes to join them to (ADR-0002).
  const warnings = [
    ...plan.warnings,
    ...(profile.layout
      ? []
      : [
          `the \`${config.profile}\` profile has no layout engine, so no changed region in ` +
            'this report could be joined to the node that occupies it; every region is ' +
            'reported unattributed rather than attributed to a guess',
        ]),
  ];

  // Opened once, before the first lookup, because a durable baseline is stored
  // per renderer identity and a run that guessed one would read another
  // machine's directory. Deferring the *launch* was never the saving on offer:
  // it is 205ms once, against ~65ms of rasterization per subject (journal 0007,
  // ADR-0010). What this command defers is the per-subject render, and that is
  // what `settle` is for.
  const renderer = await deps.renderer();

  try {
    const budget = { remaining: config.alone?.limit ?? DEFAULT_ALONE_LIMIT };
    const decoder = await decoderFor(config);

    return await observeAll(
      plan,
      {
        config,
        deps,
        renderer,
        budget,
        ...(options.flakes === true ? { sweep: true } : {}),
        ...(decoder !== undefined ? { decoder } : {}),
      },
      options,
      {
      observations,
      notObserved,
      warnings,
    });
  } finally {
    // A renderer is a browser, which is a child process, and nothing above this
    // function opened it — `deps.renderer()` is a factory, so the only code that
    // knows one was ever needed is this one.
    //
    // Found by the first real `variance run` and by nothing before it: every
    // test in `run.test.ts` injects a fake renderer, and a fake costs nothing to
    // leave open. What a real one costs is a command that produces a correct
    // report, prints it, and then never exits.
    await renderer.close();
  }
}

/** The loop, extracted only so `run` can own the renderer's lifetime in one place. */
async function observeAll(
  plan: Plan,
  context: ObserveContext,
  options: RunOptions,
  accumulated: {
    observations: CliObservationRecord[];
    notObserved: NotObserved[];
    warnings: readonly string[];
  },
): Promise<CliRunReport> {
  const { config, deps, renderer } = context;
  const { observations, notObserved, warnings } = accumulated;

  // One slot per planned subject, filled out of order and read back in order.
  // The report has to be a function of the plan and nothing else: a run whose
  // observation order depended on which subject finished first would produce a
  // different file on every execution, and `variance run` writing a different
  // artifact from the same inputs would undo the whole determinism argument.
  const slots: (Outcome | null)[] = Array.from(
    { length: plan.subjects.length },
    () => null,
  );

  // Filled only when this run has both a store and an identity to write under.
  // The check is here rather than inside the recorder so that a run with no
  // history configured never hashes a snapshot it is not going to send.
  const recording = options.identity !== undefined && config.history !== undefined;
  const readings: (SubjectHistory | null)[] = Array.from(
    { length: plan.subjects.length },
    () => null,
  );

  // The collector is a single standing world (ADR-0009), so exactly one call may
  // be in flight — collecting two subjects at once would render them into one
  // document and let each decide the other's verdict. The raster tier has no
  // such constraint and is where the time is, so this is the shape: a serial
  // lane for collection, everything downstream concurrent.
  const collecting = serial();

  let storeFailure: unknown;

  await pool(concurrencyOf(config), plan.subjects, async (planned, index) => {
    const id = planned.subject.id;

    // Once a store has failed the run is over, so later subjects stop rather
    // than each paying a render to reach the same conclusion.
    if (storeFailure !== undefined) return;

    if (options.subjects !== undefined && !matchesGlob(options.subjects, id)) {
      slots[index] = {
        kind: 'not-observed',
        entry: {
          subject: id,
          kind: 'excluded',
          because: shardFilterBecause(options.subjects),
        },
      };
      return;
    }

    const collected = await collecting(async () => deps.collector.collect(planned));
    if (!collected.ok) {
      slots[index] = {
        kind: 'not-observed',
        entry: { subject: id, kind: 'failed', because: collected.because },
      };
      return;
    }

    // Kept per subject, in plan order, and only when there is a record to write
    // to. A quiet subject is the one the denominator is made of, so this is taken
    // here — before the verdict — rather than from the observation, which knows
    // nothing about the reading that settled.
    if (recording && collected.snapshot !== undefined) {
      readings[index] = {
        subject: id,
        snapshot: collected.snapshot,
        ...(collected.source !== undefined ? { source: collected.source } : {}),
      };
    }

    try {
      slots[index] = await observeOne(planned, collected, context, collecting);
    } catch (error) {
      if (error instanceof RasterStoreError) {
        // Spec 0004: a store failure is not a verdict. Reporting an unreachable
        // endpoint as `new` would make the next `accept` overwrite the only copy
        // of what the subject looked like before, while reporting success.
        // Captured rather than thrown, because throwing out of one worker while
        // the others are mid-render leaves browser pages leased and the error
        // racing whichever of them rejects next.
        storeFailure ??= new OperatorError(
          `the baseline store failed while observing \`${id}\`: ${messageOf(error)}. ` +
            'No verdict was reached and no baseline was written.',
          { cause: error },
        );
        return;
      }
      // Anything else is about this subject, not about the run. Recorded and the
      // run continues: one component that throws must not cost the other 299
      // their observations.
      slots[index] = {
        kind: 'not-observed',
        entry: {
          subject: id,
          kind: 'failed',
          because: `observing it failed: ${messageOf(error)}`,
        },
      };
    }
  });

  if (storeFailure !== undefined) throw storeFailure;

  for (const outcome of slots) {
    if (outcome === null) continue;
    if (outcome.kind === 'observed') observations.push(outcome.record);
    else notObserved.push(outcome.entry);
  }

  const intent = options.intent ?? config.intent;
  const at = deps.now();

  // Folded from the observations rather than accumulated during the loop, so it
  // is a function of the report and not of the order subjects finished in — and
  // so a rule that resolved nowhere is visible, which no per-subject count can
  // say on its own.
  // The plan's vocabulary, so a rule naming a tag nothing wears can be reported.
  // Read from the plan rather than the config: what words *exist* is the
  // artifact's to say, and what they *mean* is the operator's.
  const worn = new Set(plan.subjects.flatMap((planned) => planned.tags ?? []));
  const ignores = ledgerOf(config.ignore ?? [], observations, at, worn);

  // Built from the plan rather than from the observations, so a rule that
  // matched nothing is a line rather than a silence — the same reason the ignore
  // ledger takes the plan's vocabulary.
  const sensitivities = sensitivityLedgerOf(config.sensitivity ?? [], plan.subjects, observations);

  // One set for the run, folded from the outcomes. Contract 2: this is the only
  // alteration the tool makes to somebody else's page, and a report that shows a
  // fade-in captured at its first frame without saying the frame was chosen is a
  // report whose reader has been handed an image nobody described.
  const applied = new Set(
    slots.flatMap((slot) => (slot?.kind === 'observed' ? [...(slot.stabilization ?? [])] : [])),
  );

  // After the verdicts and before the report is written, because the flakiness
  // answer must include *this* run: a reader told "6 occurrences, and the last
  // sweep still saw it" is reading a sentence that accounts for the finding in
  // front of them. Asked before the write it would be off by one, in the
  // reassuring direction.
  const recorded = await recordIfConfigured({
    config,
    deps,
    at,
    ...(options.identity !== undefined ? { identity: options.identity } : {}),
    swept: context.sweep === true,
    readings,
    observations,
  });

  const report: CliRunReport = {
    runVersion: 1,
    at,
    identity: renderer.identity,
    retention: config.retention,
    ...(intent !== undefined ? { intent } : {}),
    observations,
    notObserved,
    ...(recorded.flakiness !== undefined ? { flakiness: recorded.flakiness } : {}),
    ...(warnings.length + recorded.warnings.length > 0
      ? { warnings: [...warnings, ...recorded.warnings] }
      : {}),
    ...(ignores !== undefined ? { ignores } : {}),
    ...(sensitivities !== undefined ? { sensitivities } : {}),
    ...(applied.size > 0 ? { stabilization: [...applied].sort() } : {}),
  };

  await deps.writeReport(config.report, report);
  return report;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
