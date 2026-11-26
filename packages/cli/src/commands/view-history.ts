// compass: variance-authority.reach.crossings
/**
 * The run series `variance view` draws: every mainline record the share keeps
 * at a commit in the window, each read whole, once.
 *
 * A kept record never changes under its digest, so what is derived from it is
 * kept beside the share mirror under that digest, and a second open reads
 * nothing it read before. The page carries the summaries, never the records.
 */

import { readFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { atCommit, readLine, type KeptAt, type LineCell, type ShareMiss } from '@variance-authority/core/share';
import { fileTimes, retriedIn } from '@variance-authority/sense';
import { caseSectionsOf, openTestCoverage, pool, rawRecord } from '@variance-authority/sense/test-selection';
import { settle } from '../settle.js';
import { readSuiteEntry, suiteOfEntry } from '../share-entries.js';
import { describeMiss } from './share.js';
import { openCases } from './view-cases.js';
import type { FileRuns, History, HistoryPoint, Moved, RecordSummary, RetriedCase, Skipped } from './view-history-tables.js';

const DAY = 86_400_000;
/** Bumped when a summary's shape changes, so an older one is read again. */
const SUMMARY_VERSION = 4;
/** Records read at once: a share answers each over the network. */
const READING = 8;
const MOVERS = 3;
const PARTIAL = 'a partial run: it holds only the tests it ran';

/** What one record, `coverage.bin` as a suite entry carries it, says of its run. */
export function summaryOf(bytes: Uint8Array): RecordSummary {
  const view = openTestCoverage(rawRecord(bytes));
  const files = fileTimes(view).map(([file, took]): [string, number | null] => [file, took ?? null]);
  const sections = caseSectionsOf(bytes);
  const retried = retriedIn(bytes);
  const index = sections.index === undefined ? undefined : openCases(sections.index, '', '');
  const blocks = view.moduleBlocks.all();
  const sets = view.blockSet.all();
  let reached = 0;
  for (let module = 0; module + 1 < blocks.length; module += 1) {
    for (let block = blocks[module]!; block < blocks[module + 1]!; block += 1) {
      if (view.crossings.count(sets[block]!) > 0) {
        reached += 1;
        break;
      }
    }
  }
  const timed = files.filter(([, took]) => took !== null);
  return {
    files,
    ...(timed.length === 0 ? {} : { total: timed.reduce((sum, [, took]) => sum + took!, 0) }),
    reached,
    ...(index === undefined ? {} : { cases: index.count }),
    ...(retried === undefined ? {} : { retried: retried.map(lostTo).sort((a, b) => (b.lost ?? -1) - (a.lost ?? -1) || codeUnitOrder(a.file, b.file) || codeUnitOrder(a.name, b.name)) }),
  };
}

/** A retried case and the summed time of every attempt before its last, the one its runner reported. */
function lostTo({ file, name, attempts }: { readonly file: string; readonly name: string; readonly attempts: readonly { readonly duration?: number }[] }): RetriedCase {
  const earlier = attempts.slice(0, -1);
  // An attempt the runner kept no time for cost something unknown, not nothing.
  return earlier.some((one) => one.duration === undefined) ? { name, file } : { name, file, lost: earlier.reduce((sum, one) => sum + one.duration!, 0) };
}

/** One record's summary, and where the share kept it. */
export interface Summarised extends RecordSummary {
  readonly commit: string;
  readonly written: number;
  readonly suite: string;
}

/**
 * The summaries as a series: one point per commit and suite, each carrying its
 * move from the suite's point at the commit before it on `order`, the
 * mainline's first-parent history oldest first, and each test file across the
 * window. A commit `order` does not hold is drawn and moves nothing: the share
 * wrote it, but git cannot say what came before it. A move is summed over the
 * files both runs timed, so a file added, dropped or untimed in either moves
 * nothing.
 */
export function seriesOf(
  summarised: readonly Summarised[],
  order: readonly string[],
): { readonly points: readonly HistoryPoint[]; readonly files: readonly FileRuns[]; readonly unplaced: number } {
  const ordered = [...summarised].sort((a, b) => a.written - b.written || codeUnitOrder(a.suite, b.suite) || codeUnitOrder(a.commit, b.commit));
  const place = new Map(order.map((commit, at) => [commit, at]));
  const moves = new Map<Summarised, Moved>();
  const last = new Map<string, Summarised>();
  for (const one of ordered.filter((held) => place.has(held.commit)).sort((a, b) => place.get(a.commit)! - place.get(b.commit)! || codeUnitOrder(a.suite, b.suite))) {
    const before = last.get(one.suite);
    last.set(one.suite, one);
    const moved = before === undefined ? undefined : movedFrom(before, one);
    if (moved !== undefined) moves.set(one, moved);
  }
  const runs = new Map<string, { suite: string; file: string; runs: number; timed: number; took: number }>();
  const points = ordered.map((one): HistoryPoint => {
    for (const [file, took] of one.files) {
      const key = `${one.suite}\u0000${file}`;
      const held = runs.get(key) ?? { suite: one.suite, file, runs: 0, timed: 0, took: 0 };
      held.runs += 1;
      if (took !== null) {
        held.timed += 1;
        held.took += took;
      }
      runs.set(key, held);
    }
    const moved = moves.get(one);
    return {
      commit: one.commit,
      written: one.written,
      suite: one.suite,
      ...(one.total === undefined ? {} : { total: one.total }),
      testFiles: one.files.length,
      reached: one.reached,
      ...(one.cases === undefined ? {} : { cases: one.cases }),
      ...(one.retried === undefined ? {} : { retried: one.retried }),
      ...(moved === undefined ? {} : { moved }),
    };
  });
  const files = [...runs.values()].sort((a, b) => codeUnitOrder(a.suite, b.suite) || codeUnitOrder(a.file, b.file));
  return { points, files, unplaced: new Set(ordered.filter((one) => !place.has(one.commit)).map((one) => one.commit)).size };
}

function movedFrom(before: Summarised, now: Summarised): Moved | undefined {
  const was = new Map(before.files);
  const both = now.files.flatMap(([file, took]) => {
    const then = was.get(file);
    return took === null || then === undefined || then === null ? [] : [[file, took - then] as const];
  });
  if (both.length === 0) return undefined;
  const files = both
    .filter(([, delta]) => delta !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || codeUnitOrder(a[0], b[0]))
    .slice(0, MOVERS);
  return { before: before.commit, delta: both.reduce((sum, [, delta]) => sum + delta, 0), files };
}

export interface HistoryOptions {
  /** How far back, in ms. */
  readonly since: number;
  readonly now: number;
  /** The cache root; summaries are kept in its `history/`. */
  readonly cacheDir: string;
  /** The kept commits on the mainline's first-parent history, oldest first: what a move is measured from. */
  readonly order: (kept: ReadonlySet<string>) => Promise<readonly string[]>;
  /** A line for a person waiting on a cold read. */
  readonly progress?: (line: string) => void;
}

/** What a kept commit's manifest names: its suites, each by the digest its record is kept under. */
interface Named {
  readonly suite: string;
  readonly digest: string;
  readonly partial?: true;
}

/**
 * Every suite record `mainline` keeps at a commit written in the window, summarised; each one not read is named with why.
 *
 * A commit's manifest is kept beside the summaries under the commit and the
 * time the share wrote it, so a warm open reads the listing and nothing else:
 * a commit is read from the share only where it, or a record it names, is new.
 */
export async function historyOf(cell: LineCell, mainline: string, options: HistoryOptions): Promise<History> {
  const days = `${Math.round(options.since / DAY)} days`;
  if (cell.commits === undefined) return { unread: 'the share keeps only the latest record of each line, so it holds no series' };
  const line = { kind: 'mainline', name: mainline } as const;
  const listed = await cell.commits(line);
  if (!Array.isArray(listed)) return { unread: `the share could not list the commits it keeps: ${describeMiss(listed as ShareMiss)}` };
  const kept = listed.filter((one) => one.written >= options.now - options.since).sort((a, b) => a.written - b.written || codeUnitOrder(a.commit, b.commit));
  if (kept.length === 0) return { unread: `the share keeps no record of ${mainline} from the last ${days}` };

  const dir = join(options.cacheDir, 'history');
  const skipped: Skipped[] = [];
  const summarised: Summarised[] = [];
  const cold: KeptAt[] = [];
  for (const one of kept) {
    const named = await heldJson<readonly Named[]>(dir, manifestName(one));
    const summaries = named === undefined ? undefined : await Promise.all(named.map(async (entry) => (entry.partial === true ? PARTIAL : await heldJson<RecordSummary>(dir, entry.digest))));
    if (named === undefined || summaries === undefined || summaries.includes(undefined)) {
      cold.push(one);
      continue;
    }
    named.forEach((entry, at) => {
      const summary = summaries[at]!;
      if (typeof summary === 'string') skipped.push({ commit: one.commit, suite: entry.suite, why: summary });
      else summarised.push({ commit: one.commit, written: one.written, suite: entry.suite, ...summary });
    });
  }

  if (cold.length > 0) options.progress?.(`reading ${cold.length} ${cold.length === 1 ? 'commit' : 'commits'} kept on ${mainline} in the last ${days}`);
  let done = 0;
  await pool(READING, cold, async (one) => {
    await readCommit(one);
    done += 1;
    options.progress?.(`read ${done} of ${cold.length}`);
  });
  skipped.sort((a, b) => codeUnitOrder(a.commit, b.commit) || codeUnitOrder(a.suite ?? '', b.suite ?? ''));
  const order = await options.order(new Set(summarised.map((one) => one.commit)));
  return { ...seriesOf(summarised, order), since: options.since, skipped };

  async function readCommit(one: KeptAt): Promise<void> {
    const held = await readLine(cell, atCommit(line, one.commit));
    if (!('manifest' in held)) {
      skipped.push({ commit: one.commit, why: describeMiss(held) });
      return;
    }
    const named: Named[] = [];
    for (const entry of held.manifest.entries) {
      const suite = suiteOfEntry(entry.name);
      if (suite === undefined) continue;
      named.push({ suite, digest: entry.digest, ...(entry.partial === true ? { partial: true as const } : {}) });
      if (entry.partial === true) {
        skipped.push({ commit: one.commit, suite, why: PARTIAL });
        continue;
      }
      const summary = (await heldJson<RecordSummary>(dir, entry.digest)) ?? (await summarise(() => held.entry(entry)));
      if (typeof summary === 'string') {
        skipped.push({ commit: one.commit, suite, why: summary });
        continue;
      }
      await keep(dir, entry.digest, summary);
      summarised.push({ commit: one.commit, written: one.written, suite, ...summary });
    }
    // Kept only once every record it names is summarised, so a record that
    // could not be read is asked for again on the next open.
    if (!skipped.some((miss) => miss.commit === one.commit && miss.why !== PARTIAL)) await keep(dir, manifestName(one), named);
  }
}

/** A commit's manifest is named for the commit and when the share wrote it: a republish at that commit is another name. */
const manifestName = (one: KeptAt): string => `${one.commit}@${one.written}`;

/** One record's summary, or why it could not be read. */
async function summarise(read: () => Promise<Uint8Array | ShareMiss>): Promise<RecordSummary | string> {
  try {
    const bytes = await read();
    if (!(bytes instanceof Uint8Array)) return describeMiss(bytes);
    const entry = readSuiteEntry(bytes);
    return typeof entry === 'string' ? entry : summaryOf(entry.coverage);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** What an earlier open kept, marked as opened now: `prune-cache` sweeps by age, and a window still reading it keeps it. */
async function heldJson<T>(dir: string, name: string): Promise<T | undefined> {
  try {
    const path = join(dir, `${name}.json`);
    const held = JSON.parse(await readFile(path, 'utf8')) as { readonly version: number; readonly held: T };
    if (held.version !== SUMMARY_VERSION) return undefined;
    const now = new Date();
    await utimes(path, now, now).catch(() => undefined);
    return held.held;
  } catch {
    return undefined;
  }
}

/** Keeps what was derived for the next open; a cache that cannot be written only costs that open a read. */
async function keep(dir: string, name: string, held: unknown): Promise<void> {
  try {
    await settle(join(dir, `${name}.json`), new TextEncoder().encode(JSON.stringify({ version: SUMMARY_VERSION, held })));
  } catch {
    // Nothing to do: what it holds is already in the series.
  }
}
