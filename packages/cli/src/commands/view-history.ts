// compass: variance-authority.reach.crossings
/**
 * The run series `variance view` draws: every mainline record the share keeps
 * at a commit in the window, each read whole, once.
 *
 * A kept record never changes under its digest, so what is derived from it is
 * kept beside the share mirror under that digest, and a second open reads
 * nothing it read before. The page carries the summaries, never the records.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { atCommit, readLine, type LineCell, type ShareMiss } from '@variance-authority/core/share';
import { openSetColumns } from '@variance-authority/sense/record';
import { caseSectionsOf, costs, openTestCoverage, rawRecord, readableAttempts, retriedAttempts, type RecordedAttempt } from '@variance-authority/sense/test-selection';
import { settle } from '../settle.js';
import { readSuiteEntry, suiteOfEntry } from '../share-entries.js';
import { describeMiss } from './share.js';
import type { FileRuns, History, HistoryPoint, Moved, RecordSummary, RetriedCase, Skipped } from './view-history-tables.js';

const DAY = 86_400_000;
/** Bumped when a summary's shape changes, so an older one is read again. */
const SUMMARY_VERSION = 2;
/** Records read at once: a share answers each over the network. */
const READING = 8;
const MOVERS = 3;
const PARTIAL = 'a partial run: it holds only the tests it ran';

/** What one record, `coverage.bin` as a suite entry carries it, says of its run. */
export function summaryOf(bytes: Uint8Array): RecordSummary {
  const view = openTestCoverage(rawRecord(bytes));
  const cost = costs(view);
  const files = Array.from(view.testPath.all(), (id, test): [string, number | null] => [view.string(id), cost(test) ?? null]);
  const sections = caseSectionsOf(bytes);
  const attempts = readableAttempts(sections.attempts);
  const index = sections.index === undefined ? undefined : openSetColumns(sections.index);
  return {
    files,
    total: files.reduce((sum, [, took]) => sum + (took ?? 0), 0),
    ...(index === undefined ? {} : { cases: index.testId.length }),
    ...(attempts === undefined ? {} : { retried: retriedOf(retriedAttempts(attempts), index) }),
  };
}

function retriedOf(rows: readonly RecordedAttempt[], index: ReturnType<typeof openSetColumns>): RetriedCase[] {
  const byCase = new Map<string, RecordedAttempt[]>();
  for (const row of rows) byCase.set(row.case, [...(byCase.get(row.case) ?? []), row]);
  if (byCase.size === 0) return [];
  const decoder = new TextDecoder();
  const string = (id: number) => decoder.decode(index!.strings.blob.subarray(index!.strings.offsets[id]!, index!.strings.offsets[id + 1]!));
  const rowOf = new Map<string, number>();
  for (let row = 0; row < (index?.testId.length ?? 0); row += 1) rowOf.set(string(index!.testId[row]!), row);
  const retried: RetriedCase[] = [];
  for (const [id, attempts] of byCase) {
    const last = Math.max(...attempts.map((one) => one.attempt));
    const row = rowOf.get(id);
    retried.push({
      case: id,
      name: row === undefined ? id : string(index!.testName[row]!),
      ...(row === undefined ? {} : { file: string(index!.testFile[row]!) }),
      lost: attempts.filter((one) => one.attempt < last).reduce((sum, one) => sum + (one.duration ?? 0), 0),
    });
  }
  return retried.sort((a, b) => b.lost - a.lost || codeUnitOrder(a.case, b.case));
}

/** One record's summary, and where the share kept it. */
export interface Summarised extends RecordSummary {
  readonly commit: string;
  readonly written: number;
  readonly suite: string;
}

/**
 * The summaries as a series: one point per commit and suite, each carrying its
 * move from the suite's point before, and each test file across the window.
 * A move is summed over the files both runs timed, so a file added, dropped
 * or untimed in either moves nothing.
 */
export function seriesOf(summarised: readonly Summarised[]): { readonly points: readonly HistoryPoint[]; readonly files: readonly FileRuns[] } {
  const ordered = [...summarised].sort((a, b) => a.written - b.written || codeUnitOrder(a.suite, b.suite) || codeUnitOrder(a.commit, b.commit));
  const last = new Map<string, Summarised>();
  const runs = new Map<string, { suite: string; file: string; runs: number; timed: number; took: number }>();
  const points = ordered.map((one): HistoryPoint => {
    const before = last.get(one.suite);
    last.set(one.suite, one);
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
    const moved = before === undefined ? undefined : movedFrom(before, one);
    return {
      commit: one.commit,
      written: one.written,
      suite: one.suite,
      total: one.total,
      testFiles: one.files.length,
      ...(one.cases === undefined ? {} : { cases: one.cases }),
      ...(one.retried === undefined ? {} : { retried: one.retried }),
      ...(moved === undefined ? {} : { moved }),
    };
  });
  const files = [...runs.values()].sort((a, b) => codeUnitOrder(a.suite, b.suite) || codeUnitOrder(a.file, b.file));
  return { points, files };
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
  /** A line for a person waiting on a cold read. */
  readonly progress?: (line: string) => void;
}

interface Wanted {
  readonly commit: string;
  readonly written: number;
  readonly suite: string;
  readonly digest: string;
  read(): Promise<Uint8Array | ShareMiss>;
}

/** Every suite record `mainline` keeps at a commit written in the window, summarised; each one not read is named with why. */
export async function historyOf(cell: LineCell, mainline: string, options: HistoryOptions): Promise<History> {
  const days = `${Math.round(options.since / DAY)} days`;
  if (cell.commits === undefined) return { unread: 'the share keeps only the latest record of each line, so it holds no series' };
  const line = { kind: 'mainline', name: mainline } as const;
  const listed = await cell.commits(line);
  if (!Array.isArray(listed)) return { unread: `the share could not list the commits it keeps: ${describeMiss(listed as ShareMiss)}` };
  const kept = listed.filter((one) => one.written >= options.now - options.since).sort((a, b) => a.written - b.written || codeUnitOrder(a.commit, b.commit));
  if (kept.length === 0) return { unread: `the share keeps no record of ${mainline} from the last ${days}` };

  const skipped: Skipped[] = [];
  const wanted: Wanted[] = [];
  const lines = await pooled(kept, async (one) => ({ one, held: await readLine(cell, atCommit(line, one.commit)) }));
  for (const { one, held } of lines) {
    if (!('manifest' in held)) {
      skipped.push({ commit: one.commit, why: describeMiss(held) });
      continue;
    }
    for (const entry of held.manifest.entries) {
      const suite = suiteOfEntry(entry.name);
      if (suite === undefined) continue;
      if (entry.partial === true) skipped.push({ commit: one.commit, suite, why: PARTIAL });
      else wanted.push({ commit: one.commit, written: one.written, suite, digest: entry.digest, read: () => held.entry(entry) });
    }
  }

  const dir = join(options.cacheDir, 'history');
  const summarised: Summarised[] = [];
  const cold: Wanted[] = [];
  for (const one of wanted) {
    const summary = await cached(dir, one.digest);
    if (summary === undefined) cold.push(one);
    else summarised.push({ commit: one.commit, written: one.written, suite: one.suite, ...summary });
  }
  if (cold.length > 0) options.progress?.(`reading ${cold.length} ${cold.length === 1 ? 'record' : 'records'} kept on ${mainline} in the last ${days}`);
  let done = 0;
  await pooled(cold, async (one) => {
    const read = await summarise(one);
    done += 1;
    options.progress?.(`read ${done} of ${cold.length}`);
    if (typeof read === 'string') {
      skipped.push({ commit: one.commit, suite: one.suite, why: read });
      return;
    }
    await keep(dir, one.digest, read);
    summarised.push({ commit: one.commit, written: one.written, suite: one.suite, ...read });
  });
  skipped.sort((a, b) => codeUnitOrder(a.commit, b.commit) || codeUnitOrder(a.suite ?? '', b.suite ?? ''));
  return { ...seriesOf(summarised), since: options.since, skipped };
}

/** One record's summary, or why it could not be read. */
async function summarise(one: Wanted): Promise<RecordSummary | string> {
  try {
    const bytes = await one.read();
    if (!(bytes instanceof Uint8Array)) return describeMiss(bytes);
    const entry = readSuiteEntry(bytes);
    return typeof entry === 'string' ? entry : summaryOf(entry.coverage);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** `run` over `items`, at most `READING` at once, in their order. */
async function pooled<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      out[at] = await run(items[at]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READING, items.length) }, worker));
  return out;
}

async function cached(dir: string, digest: string): Promise<RecordSummary | undefined> {
  try {
    const held = JSON.parse(await readFile(join(dir, `${digest}.json`), 'utf8')) as { readonly version: number; readonly summary: RecordSummary };
    return held.version === SUMMARY_VERSION ? held.summary : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps a summary for the next open; a cache that cannot be written only costs that open a read. */
async function keep(dir: string, digest: string, summary: RecordSummary): Promise<void> {
  try {
    await settle(join(dir, `${digest}.json`), new TextEncoder().encode(JSON.stringify({ version: SUMMARY_VERSION, summary })));
  } catch {
    // Nothing to do: the summary is already in the series.
  }
}
