// compass: variance-authority.reach
/**
 * Where and when the test files a `covering` answer names last ran, which is
 * how fresh the answer is.
 *
 * A snapshot names the commit of its latest run, and a partial run is a run:
 * after one, the snapshot stands at a commit most of its tests never ran at.
 * Dated by that commit, an answer whose every case last ran a day earlier, over
 * another text, reads as minutes old. The runs record beside the snapshot says
 * where each test last ran, and `readingFrom` reads it for every selector, so
 * the answer is dated from it too, for the test files it names and no others: a
 * test that ran somewhere else says nothing about this answer.
 *
 * A run's own time is said when the record holds it, which it does for the
 * runs at the snapshot's commit. Any other stand is dated by its commit's time,
 * and said to be that. Whether the asked file is the text such a run read is
 * said from git's list of the files changed between its commit and the
 * snapshot's, so locality is a file's: an edit elsewhere in the tree does not
 * make the answer older.
 */

import { realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { readCommitRuns, readingFrom, type CommitRuns, type ExecutionTest } from '@variance-authority/sense/test-selection';
import { committedAt } from '@variance-authority/sense';
import { gitIn, topLevel } from './since.js';
import { listedIn } from './covering-where.js';

/** Where some of the test files an answer names last ran, and when. */
export interface RanStand {
  /** The commit they last ran at. */
  readonly commit: string;
  /** In code-unit order. */
  readonly tests: readonly string[];
  /**
   * When the runs at `commit` landed, as the runs record beside the snapshot
   * holds it: the first and the latest, and how many there were. Present only
   * for the snapshot's own commit, which is the one the record keeps runs for.
   */
  readonly landed?: { readonly first: string; readonly latest: string; readonly runs: number };
  /** Without `landed`: when `commit` was committed, as a UTC ISO time. */
  readonly committedAt?: string;
  /** Without `landed`: this clone does not hold `commit`, so it has no time. */
  readonly held?: false;
  /** Without `landed`: the first line git gave for not dating `commit`. */
  readonly unread?: string;
  /** The asked files whose text changed between `commit` and the snapshot's, so these runs read another one. */
  readonly otherText?: readonly string[];
}

/**
 * Where the test files an answer names last ran: one stand per commit, in the
 * order their runs landed, earliest first, with `assumed` saying where the runs
 * record could not place some of them and what was read instead. Or, with
 * `unread`, why that is not known, and the test files it is not known for.
 */
export type CoveringRan =
  | { readonly stands: readonly RanStand[]; readonly assumed?: string }
  | { readonly tests: readonly string[]; readonly unread: string };

/**
 * What an answer names that ran: the cases it lists, the cases that stopped
 * before the line, function or changed region, and the test files that hold
 * the file as a precondition.
 */
export interface RanNamed {
  readonly tests?: readonly ExecutionTest[];
  readonly ranges?: readonly { readonly tests: readonly ExecutionTest[] }[];
  readonly changed?: readonly {
    readonly regions: readonly { readonly tests: readonly ExecutionTest[]; readonly stopped?: readonly ExecutionTest[] }[];
    readonly cases: readonly ExecutionTest[];
  }[];
  readonly stopped?: readonly ExecutionTest[];
  readonly preconditionOf?: readonly string[];
}

/**
 * Where the test files `named` last ran, read from the runs record beside
 * `snapshot`, the record whose commit is `at`. `asked` are the files the
 * question is about, named from `root`. Absent when the answer names no test
 * file, so there is nothing to date.
 */
export async function ranFor(
  named: readonly string[],
  record: { readonly root: string; readonly snapshot: string | undefined; readonly at: string | undefined; readonly asked: readonly string[] },
): Promise<CoveringRan | undefined> {
  const tests = [...new Set(named)].sort();
  if (tests.length === 0) return undefined;
  const { root, snapshot, at } = record;
  if (at === undefined || snapshot === undefined) return { tests, unread: 'the record names no commit' };
  let runs: CommitRuns | undefined;
  try {
    runs = await readCommitRuns(snapshot);
  } catch (error) {
    return { tests, unread: error instanceof Error ? error.message : String(error) };
  }
  const repository = await topLevel(root);
  const reading = readingFrom({ commit: at, ref: undefined, runs, tests, git: gitIn(repository ?? root) });
  if (reading.widened !== undefined) return { tests, unread: reading.widened };
  // `git diff` names files from the repository's top, and the answer from the root it was asked under.
  const under = repository === undefined ? '' : relative(await realpath(repository), await realpath(root));
  const repoPath = (file: string): string => (under === '' ? file : join(under, file).split(sep).join('/'));
  const standing = new Set(reading.stands.flatMap((stand) => stand.tests));
  const here = tests.filter((test) => !standing.has(test));
  const observed = runs?.commit === at && runs.runs > 0 && here.every((test) => runs.files.includes(test)) ? runs : undefined;
  const stands: RanStand[] = [
    ...reading.stands.map((stand) => {
      const changed = new Set(stand.changed);
      const other = record.asked.filter((file) => changed.has(repoPath(file)));
      return { commit: stand.commit, tests: stand.tests, ...dated(root, stand.commit), ...(other.length === 0 ? {} : { otherText: other }) };
    }),
    ...(here.length === 0
      ? []
      : [{ commit: at, tests: here, ...(observed === undefined ? dated(root, at) : { landed: { first: observed.first, latest: observed.latest, runs: observed.runs } }) }]),
  ];
  return { stands, ...(reading.assumed === undefined ? {} : { assumed: reading.assumed }) };
}

/** When `commit` was committed, or why the clone at `root` cannot say. */
function dated(root: string, commit: string): Pick<RanStand, 'committedAt' | 'held' | 'unread'> {
  const committed = committedAt(root, commit);
  if (committed === false) return { held: false };
  return typeof committed === 'string' ? { committedAt: committed } : { unread: committed.unread };
}

/** The test files an answer names, by their paths. */
export function namedTestFiles(answer: RanNamed): readonly string[] {
  const stopped = [...(answer.stopped ?? []), ...(answer.changed ?? []).flatMap((file) => file.regions.flatMap((region) => region.stopped ?? []))];
  return [...listedIn(answer), ...stopped].map((test) => test.file).concat(answer.preconditionOf ?? []);
}

/**
 * Where and when the test files an answer names last ran, in one sentence said
 * under the answer; nothing when it names none. One stand is said whole; more
 * are said as the span from the first landed to the last, with how many of the
 * test files read another text of the asked file. `at` is the record's commit.
 */
export function ranText(ran: CoveringRan | undefined, at: string | undefined, now: number): readonly string[] {
  if (ran === undefined) return [];
  const count = 'unread' in ran ? ran.tests.length : ran.stands.reduce((sum, stand) => sum + stand.tests.length, 0);
  const subject = count === 1 ? 'the test file named here' : `the ${String(count)} test files named here`;
  if ('unread' in ran) return [`Where and when ${subject} last ran is not known: ${ran.unread}.`];
  const assumed = ran.assumed === undefined ? '' : `; ${ran.assumed}`;
  const capital = `${subject[0]!.toUpperCase()}${subject.slice(1)}`;
  const record = at === undefined ? '' : ` and ${at.slice(0, 12)}`;
  if (ran.stands.length === 1) {
    const [stand] = ran.stands as [RanStand];
    const other = stand.otherText === undefined ? '' : `, over ${texts(stand.otherText)}, which changed between that commit${record}`;
    return [`${capital} last ran at ${stand.commit.slice(0, 12)}, ${when(stand, now)}${other}${assumed}.`];
  }
  const first = ran.stands[0]!;
  const last = ran.stands[ran.stands.length - 1]!;
  const over = ran.stands.filter((stand) => stand.otherText !== undefined);
  const files = [...new Set(over.flatMap((stand) => stand.otherText ?? []))];
  const others = over.length === 0
    ? ''
    : `; ${String(over.reduce((sum, stand) => sum + stand.tests.length, 0))} of them ran over ${texts(files)}, which changed between where they ran${record}`;
  return [
    `${capital} last ran at ${String(ran.stands.length)} commits, from ${first.commit.slice(0, 12)}, ${when(first, now)}, to ${
      last.commit.slice(0, 12)
    }, ${when(last, now)}${others}${assumed}.`,
  ];
}

function texts(files: readonly string[]): string {
  return files.length === 1 ? `another text of ${files[0]!}` : `other texts of ${files.slice(0, -1).join(', ')} and ${files[files.length - 1]!}`;
}

/** When a stand ran, or which commit's time stands in for it, or why neither is known. */
function when(stand: RanStand, now: number): string {
  if (stand.landed !== undefined) {
    const { first, latest, runs } = stand.landed;
    if (runs === 1) return `in a run that landed ${ago(latest, now)}`;
    const from = ago(first, now);
    const to = ago(latest, now);
    return `in one of the ${String(runs)} runs at it, which landed ${from === to ? to : `between ${from} and ${to}`}`;
  }
  if (stand.committedAt !== undefined) return `a commit made ${ago(stand.committedAt, now)}`;
  if (stand.held === false) return 'a commit this clone does not hold';
  return `a commit git could not date (${stand.unread ?? 'git gave no reason'})`;
}

/**
 * A time against `now`, floored to the unit a reader acts on: minutes in the
 * first hour, hours in the first two days, days after. A time later than `now`
 * is given as itself, since its age would be negative.
 */
function ago(iso: string, now: number): string {
  const age = now - Date.parse(iso);
  if (age < 0) return `at ${iso}, later than this machine's clock`;
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'under a minute ago';
  if (minutes < 60) return `${unit(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours < 48 ? unit(hours, 'hour') : unit(Math.floor(hours / 24), 'day')} ago`;
}

function unit(of: number, noun: string): string {
  return `${String(of)} ${noun}${of === 1 ? '' : 's'}`;
}
