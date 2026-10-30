// compass: variance-authority.reach.crossings
/**
 * Over which text each test file of a record ran each region it called into:
 * the text in the checkout, or an older one an edit since has touched. The
 * count folds the answers per region (`countCoverage`); this file reads them.
 *
 * Every reader is one that already exists. Where a test file stood is
 * `testPlaces`', which text of a file its run ran over is `ranOver`'s, read from
 * the evidence `covering` reads (`evidenceOf`), and whether an edit touched a
 * region is the rule a record carries its cases by (`regionTouched` over
 * `editsBetween`). Git says which files changed since each place, so a file
 * unchanged since every place that ran it, under rows cut from the tree's text,
 * reads no edit at all.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  digestString,
  editsBetween,
  ranOver,
  regionTouched,
  testPlaces,
  textAsks,
  type CountedSuite,
  type Edit,
  type ExecutionIndex,
  type RegionText,
  type TestPlace,
} from '@variance-authority/sense/test-selection';
import { evidenceOf, type Evidence } from './covering-ran-evidence.js';
import { rowsText, type RowsText } from './record-rows-text.js';
import { runsOf } from './record-runs.js';
import { changedFiles } from './since.js';

/** What a suite's count asks of each region a test file called into. */
export type TextOf = NonNullable<CountedSuite['textOf']>;

/**
 * Over which text each test file of `index` ran each region, for the record at
 * `record` made at `recorded`, against the checkout at `root`. Never throws: what
 * cannot be read is not known, with the reason.
 */
export async function textOver(root: string, record: string, recorded: string | undefined, index: ExecutionIndex): Promise<TextOf> {
  const read = await runsOf(record, root);
  if (read.unread !== undefined) {
    const unknown = { unknown: `the runs record beside the record does not read: ${read.unread.message}` };
    return () => unknown;
  }
  const tests = [...new Set(index.tests.map((test) => test.file))];
  const { places } = testPlaces({ commit: recorded, runs: read.runs, tests });
  const nowhere = { unknown: read.runs === undefined
    ? 'no runs record lies beside the record, so where its tests ran is not known'
    : read.runs.commit !== recorded
      ? 'the runs record beside the record lists the runs of another commit, so where its tests ran is not known'
      : 'the runs record does not say where some test files ran' };
  const commits = [...new Set([...places.values()].flatMap((place) => (place.assumed === true ? [] : place.commit ?? [])))];
  const changed = new Map(await Promise.all([...new Set([...commits, ...(recorded === undefined ? [] : [recorded])])]
    .map(async (commit) => [commit, await changedSince(root, commit)] as const)));
  // A run over the commit's text of a file git says has not changed since ran over this text.
  const unchanged = (place: TestPlace, file: string): boolean =>
    place.commit !== undefined && place.texts !== undefined && place.texts[file] === undefined && changed.get(place.commit)?.has(file) === false;

  // Only a call the count asks about is read for: a load or a case run over another text is not run.
  const asks = new Map<string, readonly (readonly [string, TestPlace])[]>();
  const steady = new Map<string, readonly (readonly [string, TestPlace])[]>();
  for (const [file, tests] of textAsks(index)) {
    const placed = [...tests].flatMap((test) => {
      const place = places.get(test);
      return place === undefined || place.assumed === true ? [] : [[test, place] as const];
    });
    (placed.every(([, place]) => unchanged(place, file)) ? steady : asks).set(file, placed);
  }
  // Rows another run cut from a text the tree no longer holds are numbered in it, so the edit since is read.
  const rows = rowDigests(record, index, new Set([...asks.keys(), ...steady.keys()]));
  const held = await Promise.all([...steady].map(async ([file, placed]) => {
    const row = rows.get(file);
    const text = typeof row !== 'string' ? undefined : await readFile(resolve(root, file), 'utf8').catch(() => undefined);
    return [file, placed, text !== undefined && digestString(text) === row] as const;
  }));
  for (const [file, placed, holds] of held) if (!holds) asks.set(file, placed);
  const texts = await readTexts(root, rows, record, asks, [...places.values()], read.repository, recorded, read.runs?.latest);
  return (file, region, test) => {
    const place = places.get(test);
    if (place === undefined || place.assumed === true) return nowhere;
    const over = texts.get(file)?.get(test);
    if (over === undefined) return 'this';
    return Array.isArray(over) ? (regionTouched(region, over) ? 'older' : 'this') : over as RegionText;
  };
}

/**
 * Per file, then per test file, what the test file's run ran the file over: the
 * edits from the text its regions are numbered in to the checkout's, or the
 * answer for every region of it.
 */
type Over = ReadonlyMap<string, ReadonlyMap<string, readonly Edit[] | RegionText>>;

/**
 * Read, for each file of `asks` and each test file placed that called into
 * it, the edits between the text the run ran and the checkout's: the text on
 * disk, the digest the record's rows took of the file, and the evidence of which
 * text each run ran over. Everything is read here, so the count reads nothing.
 */
async function readTexts(
  root: string,
  rows: ReadonlyMap<string, RowsText>,
  record: string,
  asks: ReadonlyMap<string, readonly (readonly [string, TestPlace])[]>,
  places: readonly TestPlace[],
  repository: string | undefined,
  recorded: string | undefined,
  latest: string | undefined,
): Promise<Over> {
  const over = new Map<string, ReadonlyMap<string, readonly Edit[] | RegionText>>();
  if (asks.size === 0) return over;
  const held = new Map<string, string>();
  const unread = new Map<string, RegionText>();
  for (const file of asks.keys()) {
    const text = await readFile(resolve(root, file), 'utf8').catch((error: unknown) => error as NodeJS.ErrnoException);
    if (typeof text === 'string') held.set(file, text);
    // A file gone from the checkout holds no region of this text; any other failure says nothing of the text.
    else if (text.code !== 'ENOENT') unread.set(file, { unknown: `${file} does not read: ${text.message}` });
  }
  const evidence: Evidence = await evidenceOf(places, held, {
    root, snapshot: record, repository, last: recorded === undefined ? latest : undefined, region: true, placement: undefined, ranOther: undefined,
  });
  const edits = editsBetween(root, undefined, [recorded, ...places.flatMap((place) => place.commit ?? [])]);
  // A chain is read once per text the runs ran, however many test files ran it.
  const chains = new Map<string, readonly Edit[] | RegionText>();
  for (const [file, placed] of asks) {
    const now = held.get(file);
    const row = rows.get(file);
    let nowDigest: string | undefined;
    const answer = (test: string, place: TestPlace): readonly Edit[] | RegionText => {
      const failed = unread.get(file);
      if (failed !== undefined) return failed;
      // The file is gone from the checkout, so no region of it is this text's.
      if (now === undefined) return 'older';
      if (typeof row !== 'string') return row ?? { unknown: `the record holds no digest of the text of ${file} its regions were cut from` };
      return chainOf(file, row, (nowDigest ??= digestString(now)), ranOver(place, test, file, now, evidence, false));
    };
    over.set(file, new Map(placed.map(([test, place]) => [test, answer(test, place)] as const)));
  }
  return over;

  function chainOf(file: string, row: string, nowDigest: string, ran: ReturnType<typeof ranOver>): readonly Edit[] | RegionText {
    if (ran === 'absent') return 'older';
    if (typeof ran === 'object' && 'unknown' in ran) return ran;
    if (typeof ran === 'object' && ran.text === undefined) return { unknown: `the text of ${file} that run ran over is neither kept nor committed` };
    const from = ran === 'held' ? nowDigest : digestString(ran.text!);
    const key = `${file}\0${from}`;
    let chain = chains.get(key);
    if (chain === undefined) {
      const along = [edits(file, row, from), edits(file, from, nowDigest)];
      chain = along.every((edit) => edit !== undefined)
        ? along as readonly Edit[]
        : { unknown: `a text of ${file} the record or a run names cannot be found` };
      chains.set(key, chain);
    }
    return chain;
  }
}

/** The digest the record's rows took of each asked file ({@link rowsText}), every one not known when the record does not read. */
function rowDigests(record: string, index: ExecutionIndex, asked: ReadonlySet<string>): ReadonlyMap<string, RowsText> {
  try {
    return rowsText(record, asked, index);
  } catch (error) {
    const unknown = { unknown: `the record's rows do not read: ${error instanceof Error ? error.message : String(error)}` };
    return new Map([...asked].map((file) => [file, unknown]));
  }
}

/**
 * The files git says changed between `commit` and the working tree, by their
 * names under `root`; every file, as `undefined` from `has`, when git cannot say.
 */
async function changedSince(root: string, commit: string): Promise<{ has(file: string): boolean | undefined }> {
  try {
    const files = new Set(await changedFiles(promisify(execFile), root, commit, ['--no-renames', '--relative']));
    return { has: (file) => files.has(file) };
  } catch {
    return { has: () => undefined };
  }
}

