// compass: variance-authority.reach.crossings
/**
 * The run series `variance view` draws: every mainline record the share keeps
 * at a commit in the window, each read whole, once.
 *
 * A kept record never changes under its digest, so what is derived from it is
 * kept beside the share mirror under that digest, and a second open reads
 * nothing it read before. The page carries the summaries, never the records.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atCommit, readLine, type LineCell, type ShareMiss } from '@variance-authority/core/share';
import { columnBytes } from '@variance-authority/sense/record';
import { rawRecord } from '@variance-authority/sense/test-selection';
import { readSuiteEntry } from '../share-entries.js';
import { describeMiss } from './share.js';
import type { History, HistoryPoint, RecordSummary, RetriedCase } from './view-history-tables.js';
import { openRecord } from './view-record.js';

const DAY = 86_400_000;
const SUITE = 'suite-v1/';
/** Bumped when a summary's shape changes, so an older one is read again. */
const SUMMARY_VERSION = 1;

interface RecordedAttempt {
  readonly case: string;
  readonly attempt: number;
  readonly duration?: number;
}

/** What one record, `coverage.bin` as a suite entry carries it, says of its run. */
export function summaryOf(coverage: Uint8Array): RecordSummary {
  const record = openRecord(rawRecord(coverage));
  const tests = record.coverage?.tests;
  const files: [string, number | null][] = [];
  for (let row = 0; row < (tests?.count ?? 0); row += 1) {
    const took = tests!.columns[1]!.at(row);
    files.push([String(tests!.columns[0]!.at(row)), typeof took === 'number' ? took : null]);
  }
  const modules = record.coverage?.modules;
  const testFiles = modules?.columns.find((column) => column.name === 'test files');
  let reached = 0;
  for (let row = 0; row < (modules?.count ?? 0); row += 1) {
    const count = testFiles?.at(row);
    if (typeof count === 'number' && count > 0) reached += 1;
  }
  return {
    files,
    total: files.reduce((sum, [, took]) => sum + (took ?? 0), 0),
    ...(record.cases === undefined ? {} : { cases: record.cases.count }),
    retried: retriedOf(record),
    reached,
  };
}

function retriedOf(record: ReturnType<typeof openRecord>): RetriedCase[] {
  if (!record.sections.found.has('cases.attempts')) return [];
  const held = JSON.parse(new TextDecoder().decode(columnBytes(record.sections, 'cases.attempts'))) as { readonly attempts?: readonly RecordedAttempt[] };
  const byCase = new Map<string, RecordedAttempt[]>();
  for (const one of held.attempts ?? []) byCase.set(one.case, [...(byCase.get(one.case) ?? []), one]);
  const cases = record.cases;
  const fileColumn = cases?.tests.columns.find((column) => column.name === 'test file');
  const retried: RetriedCase[] = [];
  for (const [id, attempts] of byCase) {
    if (attempts.length < 2) continue;
    const last = Math.max(...attempts.map((one) => one.attempt));
    const row = cases?.rowOf(id);
    const file = row === undefined ? undefined : fileColumn?.at(row);
    retried.push({
      case: id,
      name: row === undefined ? id : cases!.nameAt(row),
      ...(typeof file === 'string' ? { file } : {}),
      attempts: attempts.length,
      lost: attempts.filter((one) => one.attempt !== last).reduce((sum, one) => sum + (one.duration ?? 0), 0),
    });
  }
  return retried.sort((a, b) => b.lost - a.lost || (a.case < b.case ? -1 : a.case > b.case ? 1 : 0));
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

/** Every suite record `mainline` keeps at a commit written in the window, summarised. */
export async function historyOf(cell: LineCell, mainline: string, options: HistoryOptions): Promise<History> {
  const days = `${Math.round(options.since / DAY)} days`;
  if (cell.commits === undefined) return { unread: 'the share keeps only the latest record of each line, so it holds no series' };
  const line = { kind: 'mainline', name: mainline } as const;
  const listed = await cell.commits(line);
  if (!Array.isArray(listed)) return { unread: `the share could not list the commits it keeps: ${describeMiss(listed as ShareMiss)}` };
  const kept = listed.filter((one) => one.written >= options.now - options.since).sort((a, b) => a.written - b.written || (a.commit < b.commit ? -1 : 1));
  if (kept.length === 0) return { unread: `the share keeps no record of ${mainline} from the last ${days}` };

  const dir = join(options.cacheDir, 'history');
  const lines = await Promise.all(kept.map(async (one) => ({ one, held: await readLine(cell, atCommit(line, one.commit)) })));
  const wanted: { readonly commit: string; readonly written: number; readonly suite: string; readonly digest: string; read(): Promise<Uint8Array | { kind: string }> }[] = [];
  for (const { one, held } of lines) {
    if (!('manifest' in held)) continue;
    for (const entry of held.manifest.entries) {
      if (!entry.name.startsWith(SUITE) || entry.partial === true) continue;
      wanted.push({ commit: one.commit, written: one.written, suite: entry.name.slice(SUITE.length), digest: entry.digest, read: () => held.entry(entry) });
    }
  }

  const points: HistoryPoint[] = [];
  const cold: typeof wanted = [];
  for (const one of wanted) {
    const summary = await cached(dir, one.digest);
    if (summary === undefined) cold.push(one);
    else points.push({ commit: one.commit, written: one.written, suite: one.suite, ...summary });
  }
  if (cold.length > 0) {
    options.progress?.(`reading ${cold.length} ${cold.length === 1 ? 'record' : 'records'} kept on ${mainline} in the last ${days}`);
    await mkdir(dir, { recursive: true });
  }
  let done = 0;
  for (const one of cold) {
    const bytes = await one.read();
    done += 1;
    options.progress?.(`read ${done} of ${cold.length}`);
    if (!(bytes instanceof Uint8Array)) continue;
    const entry = readSuiteEntry(bytes);
    if (typeof entry === 'string') continue;
    const summary = summaryOf(entry.coverage);
    await keep(dir, one.digest, summary);
    points.push({ commit: one.commit, written: one.written, suite: one.suite, ...summary });
  }
  points.sort((a, b) => a.written - b.written || (a.suite < b.suite ? -1 : a.suite > b.suite ? 1 : 0));
  return { points, since: options.since };
}

async function cached(dir: string, digest: string): Promise<RecordSummary | undefined> {
  try {
    const held = JSON.parse(await readFile(join(dir, `${digest}.json`), 'utf8')) as { readonly version: number; readonly summary: RecordSummary };
    return held.version === SUMMARY_VERSION ? held.summary : undefined;
  } catch {
    return undefined;
  }
}

async function keep(dir: string, digest: string, summary: RecordSummary): Promise<void> {
  const path = join(dir, `${digest}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: SUMMARY_VERSION, summary }));
  await rename(temporary, path);
}
