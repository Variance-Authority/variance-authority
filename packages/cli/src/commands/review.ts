// compass: variance-authority/runtime/attention
/**
 * What a change did, and what the run after it did about it.
 *
 * Every answer in this file has an owner elsewhere, and this file only joins
 * them for the reader who has to decide whether to merge. The diff is git's.
 * The kind of edit is the addon's reading of both texts. Which cases entered a
 * changed line is the case index's. How far a test sits from the file is the
 * file graph's. What a config change reaches is each test's declared
 * preconditions. What an install moved is the lockfile's. Nothing is measured
 * here that one of those already knows.
 *
 * It runs after the suite, so the record it reads already describes the change.
 * That fixes two coordinates. The change starts where the recording stood
 * before the first run at this commit, when git says it is an ancestor: the
 * runs record keeps that commit, since the snapshot names this one. And the line
 * numbers the record holds are the working tree's, so coverage reads the diff
 * reversed, while the reading of each edit reads it forward, against the text
 * it replaced.
 */

import { existsSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  changedLines,
  readCommitRuns,
  readJourneyChange,
  whatLanded,
  type CommitRuns,
  type FileReading,
  type LineRange,
} from '@variance-authority/sense/test-selection';
import { affectedBy, type EdgeKind } from '@variance-authority/core/relate';
import { ask } from '../clone-cut.js';
import { OperatorError } from '../exit.js';
import { ownRecord, recordedSuite } from './suite-record.js';
import type { ParsedReview } from '../review-args.js';
import { motionAgainst, motionOfRuns, runsWrote } from './covering-motion.js';
import { readExecutionFor, readExecutionIndex, recordedExecutionFile } from './execution-input.js';
import { heldAsPrecondition, type HeldAsPrecondition } from './held-as-precondition.js';
import { installDiff, type DiffPoint } from './installed.js';
import { mainlineBase, mainlineMissed, type MainlineRecord } from './mainline-base.js';
import { readReviewDrift, type ReviewDrift } from './review-drift.js';
import { reviewedCommit } from './review-head.js';
import { baseIndex, casesMoved } from './review-base-cases.js';
import { everySuiteRegions } from './review-suites.js';
import { rowBlobs } from './record-rows-text.js';
import { ranAsTree, recordedRegions, removedText } from './review-region.js';
import { packagesReached } from './review-install.js';
import { changedPackagesOf } from './review-changed-packages.js';
import { diffPoint, diffSince } from './since.js';
import { probesGap, probesNote } from './probes-gap.js';
import { runsBase } from './runs-base.js';
import { indexUpToCheckout, sourceGraphFor } from './source-graph.js';
import type { BeforeReach, Review, ReviewFile, ReviewRuns } from './review-types.js';
/** How to get a clone a review can read, for a refusal to end with. */
const EVERY_COMMIT = 'check out every commit and no trees: `git clone --filter=tree:0`, or `fetch-depth: 0` with `filter: tree:0` on `actions/checkout`';

/**
 * The edges a changed package's importers are walked through. Who imports the changed code is a question about
 * source, so a package importing only a type reads the change too; one that only reads the file, as a stylesheet or a
 * `/// <depends>` does, imports nothing.
 */
const IMPORT_EDGES: readonly EdgeKind[] = ['imports', 'reexports', 'dynamic', 'type'];

/** `motion: false` leaves out the cases moved against the base, for a reading made before CI that reports none. */
export async function review(request: ParsedReview, { motion: moves = true } = {}): Promise<Review> {
  const { root } = request;
  // TODO: a repository that declares several suites is read suite by suite when none is named, grouped by kind, with a suite that has no record reported as unrecorded, as `eachSuite` already reads them for `--coverage` and the handover; `--coverage` joins every suite's changed regions, but the base, the runs and the freshness are still the named suite's, and with none named this refuses to guess which.
  const recorded = await recordedSuite(root, request.suite);
  // The runs are always this checkout's own: a base it did not record, the mainline's or the
  // primary's, describes another change, and a record seeded from it (`runs: 0`) lists none.
  const own = await ownRecord(root, request.suite);
  // A runs record that cannot be read says neither where the change starts nor
  // which test files the runs wrote. A named base answers the first; the second
  // stays open, so no case is said to have moved, and the answer says why.
  let unread: string | undefined;
  const runs = await readCommitRuns(own).catch((error: unknown) => {
    if (request.since !== undefined) {
      unread = error instanceof Error ? error.message : String(error);
      return undefined;
    }
    const why = 'It records where this change starts, and a review that read it as absent would start from a guess';
    throw new OperatorError(`${error instanceof Error ? error.message : String(error)}. ${why}. Name the base with \`--since <ref>\`.`, { cause: error });
  }).then((listed) => (listed?.runs === 0 ? undefined : listed));
  const given = request.since ?? (await runsBase(root, runs, own));
  // Runs that name no start (`runsBase`), and no base named: a suite given to a
  // share starts from the record its mainline published, as a fresh CI checkout
  // always does (ADR-0084). With no run here at all, nothing is fetched.
  const shared = given === undefined && runs !== undefined ? await mainlineBase(root, recorded.declared) : undefined;
  const mainline = shared === undefined || 'miss' in shared ? undefined : shared;
  const ref = given ?? mainline?.commit;
  if (ref === undefined) {
    throw new OperatorError(
      (runs === undefined
        ? `no run has listed itself beside \`${own}\`, so nothing records where this change starts. ` +
            'Name the base with `--since <ref>`.'
        : `the runs at ${runs.commit?.slice(0, 12) ?? 'this checkout'} name no start ` +
            'they descend from, so nothing records where this change starts. Name the base with `--since <ref>`.') +
        (shared !== undefined && 'miss' in shared ? `\n${mainlineMissed(shared)}.` : '') +
        ((await ask(root, ['rev-parse', '--is-shallow-repository'])).out === 'true'
          ? `\nThis clone is shallow, so it can lack that start: ${EVERY_COMMIT}.`
          : ''),
      { kind: 'unrecorded' },
    );
  }
  const point = await diffPoint(ref, [], root);
  const forward = point === undefined ? undefined : await diffSince(ref, [], point.base, { cwd: root });
  const backward = point === undefined ? undefined : await diffSince(ref, [], point.base, { cwd: root, reverse: true });
  if (point === undefined || forward === undefined || backward === undefined) {
    const whose = mainline === undefined ? '' : `, where mainline ${mainline.mainline} published its record of "${mainline.suite}",`;
    throw new OperatorError(
      `\`${ref}\`${whose} could not be read as a diff. Check the commit is in this checkout's history: ` +
        `a shallow clone has only the tip, so fetch the base, or ${EVERY_COMMIT}.`,
    );
  }

  // The mainline's own case index is the base the cases are compared with,
  // unless one was named — and only when the diff starts at the commit it was
  // recorded at. A record published past the merge base holds the mainline's
  // later cases, and comparing with them would report its changes as this one's.
  const against = request.against ?? (mainline !== undefined && point.base === mainline.commit ? mainline.cases : undefined);

  const named = (file: string): string => relative(point.repository, resolve(realpathSync(root), file));
  // Which text each changed file holds now is the index's name for it, so the index is brought up to the checkout first.
  const notUpdated = await indexUpToCheckout(root);
  // One it could not names the tree as the last update found it, so it names no text the record could have run as the tree.
  const graph = await sourceGraphFor(root, ['.']);
  const { relations } = graph;
  const changed = changedLines(forward);
  const sources = graph.sources([...changed.keys()]);
  const queryNames = (files: readonly string[]) => notUpdated === undefined ? graph.names(files) : new Map<string, string>();
  const names = queryNames([...changed.keys()]);
  const reading = readJourneyChange(forward, textsAt(await prefetch(point, [...changed.keys()], named)), {
    root,
    relations,
  });
  const readings = new Map(reading.readings.map((read) => [read.file, read]));

  const from = await recordedExecutionFile(root, request.suite, recorded.file);
  const now = inTreeLines(changedLines(backward), root, readings);
  const removed = removedText(forward);
  const { index: changedCases } = await readExecutionFor(from, now);
  const suiteRegions = await recordedRegions(from, changedCases, now, relations, root, removed);
  const covered = request.coverage === true
    ? await everySuiteRegions(root, { ...(recorded.declared === undefined ? {} : { suite: recorded.declared.name }), record: from, index: changedCases }, suiteRegions, now, relations, removed, names)
    : suiteRegions;
  const full = await readExecutionIndex(from);
  const held = await baseIndex(against, from, request.against === undefined && against !== undefined ? mainline : undefined);
  // With no base named, the base is the layer the runs at this commit retired,
  // and it is theirs only for the test files a run at this commit wrote to the
  // case index; for any other file it holds an earlier commit's cases.
  const wrote = against === undefined && runs !== undefined ? await runsWrote(from, runs) : undefined;
  const comparable = (file: string): boolean => against !== undefined || (unread === undefined && (wrote === undefined || ('compared' in wrote && wrote.compared.has(file))));

  // The named suite's freshness: a module another suite recorded says nothing about whether this one ran.
  const measured = [...suiteRegions].filter(([, answer]) => answer.recorded).map(([file]) => file);
  const fresh = ranAsTree(recorded.file, measured, changedCases, names);

  const tested = new Set(full.tests.map((test) => test.file));
  const files: ReviewFile[] = [];
  for (const file of [...changed.keys()].sort()) {
    const read = readings.get(file);
    const change = covered.get(file);
    const created = await point.at(named(file)) === undefined && existsSync(resolve(root, file));
    // A file no run at this commit wrote has no base, so it has no answer either: absent, not every case added.
    const cases = comparable(file) ? casesMoved(file, held, full, created) : undefined;
    files.push({
      file,
      ...(created ? { created: true } : read === undefined ? {} : readingOf(read)),
      ...(sources.has(file) ? { indexed: true } : {}),
      ...(tested.has(file) ? { holdsCases: true } : {}),
      ...(change === undefined ? {} : { recorded: change.recorded, regions: change.regions, written: now.get(file) ?? [] }),
      ...(fresh.has(file) || change?.ran === true ? { ran: true } : {}),
      ...(cases === undefined ? {} : { cases }),
    });
  }

  const changedPackages = changedPackagesOf(root, files, (seeds) => {
    const reach = affectedBy(relations, seeds, { through: IMPORT_EDGES });
    return reach.missing.length === seeds.length ? undefined : reach.files;
  });
  const suite = heldAsPrecondition(recorded.file, [...changed.keys()].map(named));
  const beyond = await installDiff(point, [...changed.keys()], root);
  const packages = beyond === undefined || 'whole' in beyond ? undefined : packagesReached(beyond.packages, relations, full);
  const motion = !moves ? undefined : against !== undefined
    ? await motionAgainst(from, against, { since: ref, mergeBase: point.base }, root)
    : wrote === undefined || unread !== undefined
      ? undefined
      : await motionOfRuns(full, from, wrote, root, ref);

  // A change with no recorded module ran nothing yet.
  const record = measured.length > 0 && fresh.size === measured.length ? 'ran' : 'before';
  const head = await reviewedCommit(point.repository, root);
  const gap = await probesGap(from, root, request.suite);
  // The baseline is the mainline's record whatever base the cases were read from, fetched here when nothing asked for it yet.
  const drift: ReviewDrift = runs === undefined ? { unchecked: 'no runs record stands beside this record, so which test files this change observed whole is not known' } : await readReviewDrift({
    root, declared: recorded.declared, record: own, runs, point, named, changed: [...changed.keys()], relations, sources: graph.sources, installed: beyond,
    commit: head?.commit, rowBlobs: (files) => rowBlobs(recorded.file, files), names: queryNames,
    mainline: shared ?? (await mainlineBase(root, recorded.declared)),
  });
  return {
    ...(head === undefined ? {} : { head }),
    from: point.base,
    record,
    base: request.since !== undefined ? 'since' : mainline === undefined ? 'recording' : 'mainline',
    ...(mainline === undefined ? {} : { mainline: mainlineOf(mainline) }),
    ...(runs === undefined ? {} : { runs: reviewRuns(runs) }),
    files,
    ...(changedPackages.length === 0 ? {} : { changedPackages }),
    ...(suite === undefined ? {} : {
      suite: suite.tests,
      before: beforeReach([...changed.keys()].map(named), suite.of),
    }),
    ...(beyond === undefined ? {} : { beyond }),
    ...(packages === undefined ? {} : { packages }),
    ...(motion === undefined ? {} : { motion }),
    ...(gap === undefined ? {} : { probes: probesNote(gap) }),
    ...(unread === undefined ? {} : { runsUnread: runsUnreadNote(unread, against !== undefined) }),
    ...(notUpdated === undefined ? {} : { notUpdated: notUpdatedNote(notUpdated) }),
    drift,
  };
}

/** `runs` as a review reports it: no `standing`, and its landings as what they say together. */
function reviewRuns({ standing: _standing, landings, ...runs }: CommitRuns): ReviewRuns {
  return { ...runs, ...whatLanded(landings) };
}

/** What a source index that could not be brought up to the checkout leaves open beside the answer. */
function notUpdatedNote(reason: string): string {
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/\.$/u, '')}, so which text the record ran over is not known, and its rows are read as the cases that stood on the changed lines.`;
}

/** What an unreadable runs record leaves open beside an answer from a named base. */
function runsUnreadNote(message: string, compared: boolean): string {
  return `${message.charAt(0).toUpperCase()}${message.slice(1).replace(/\.$/u, '')}, so which test files the runs wrote cannot be said, and ${
    compared ? 'the cases are compared with the named base\'s alone' : 'no case is said to have moved'
  }.`;
}

async function prefetch(
  point: DiffPoint,
  files: readonly string[],
  named: (file: string) => string,
): Promise<ReadonlyMap<string, string>> {
  const texts = new Map<string, string>();
  await Promise.all(files.map(async (file) => {
    const text = await point.at(named(file));
    if (text !== undefined) texts.set(file, text);
  }));
  return texts;
}

function textsAt(texts: ReadonlyMap<string, string>): (file: string) => string | undefined {
  return (file) => texts.get(file);
}
/** A line no row holds, lines counting from 1: the file is asked about, and no region meets it. */
const NO_LINE: readonly LineRange[] = [{ start: 0, end: 0 }];

/**
 * The lines of the working tree the change wrote, in the record's names.
 *
 * A reversed diff charges the gap where the base had text the tree no longer
 * does; that text is gone, and nothing is left to cover, so the gap is not
 * asked about. A file with only such gaps is asked about at {@link NO_LINE}:
 * whether the record ran it as the tree holds it still decides. A file the edit
 * reading proved changes nothing that runs is not asked about, and neither is
 * a file no longer in the tree.
 */
function inTreeLines(
  lines: ReadonlyMap<string, readonly LineRange[]>,
  root: string,
  readings: ReadonlyMap<string, FileReading>,
): ReadonlyMap<string, readonly LineRange[]> {
  const kept = new Map<string, readonly LineRange[]>();
  for (const [file, ranges] of lines) {
    if (readings.get(file)?.verdict === 'none' || !existsSync(resolve(root, file))) continue;
    const written = ranges.filter((range) => range.added === undefined);
    kept.set(file, ranges.length > 0 && written.length === 0 ? NO_LINE : written);
  }
  return kept;
}

function readingOf(read: FileReading): Pick<ReviewFile, 'verdict' | 'names' | 'unread'> {
  if (read.verdict === undefined) return { unread: read.unread };
  return read.names.length === 0 ? { verdict: read.verdict } : { verdict: read.verdict, names: read.names };
}

/** The changed files test files hold as a precondition, each with how many hold it, the most held first. */
function beforeReach(changed: readonly string[], held: HeldAsPrecondition['of']): readonly BeforeReach[] {
  return changed
    .filter((file) => held.has(file))
    .map((file) => ({ file, tests: held.get(file)!.length }))
    .sort((left, right) => right.tests - left.tests || (left.file < right.file ? -1 : 1));
}

/** What a review says about the mainline record it started from: enough to name it, and where it is kept. */
function mainlineOf(read: MainlineRecord): NonNullable<Review['mainline']> {
  return {
    name: read.mainline,
    suite: read.suite,
    commit: read.commit,
    ...(read.distance === undefined ? {} : { distance: read.distance }),
    kept: read.coverage,
    ...(read.casesUnread === undefined ? {} : { casesUnread: read.casesUnread }),
  };
}
