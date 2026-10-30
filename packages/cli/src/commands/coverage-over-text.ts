// compass: variance-authority.reach.crossings
/**
 * Over which text each test file of a record ran each region it called into:
 * the text in the checkout, or an older one an edit since has touched. The
 * count folds the answers per region (`countCoverage`); this file reads them.
 *
 * Every reader is one that already exists. Where a test file stood is
 * `testPlaces`', which text of a file its run ran over is `ranOver`'s, read from
 * the evidence `covering` reads (`evidenceOf`), and whether an edit touched a
 * region is the rule a record carries its cases by (`regionTouched` over the
 * edits between the texts). Every text is named, never hashed: the source
 * index names the text each file holds now by its git blob, the record's rows
 * name the text they were cut from the same way, a run names its text by the
 * digest the rows took of it or by its commit's blob. A text is read only to
 * diff two that the names say differ, so a file whose rows hold the tree's
 * text, run over that text by every place that ran it, reads no text at all.
 * An index brought up to the checkout lists every file in it, so a file it
 * does not hold is gone, and every region run in it ran over an older text.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  keptTexts,
  ranOver,
  regionTouched,
  testPlaces,
  textAsks,
  type CountedSuite,
  type Edit,
  type ExecutionIndex,
  type HeldNames,
  type RegionText,
  type TestPlace,
} from '@variance-authority/sense/test-selection';
import { evidenceOf, type Evidence, type NamedText } from './covering-ran-evidence.js';
import { rowsCut, type RowsCut } from './record-rows-text.js';
import { runsOf } from './record-runs.js';
import type { IndexNames } from './source-graph.js';

/** What a suite's count asks of each region a test file called into. */
export type TextOf = NonNullable<CountedSuite['textOf']>;

/** Why a text is not known. */
type Unknown = { readonly unknown: string };

/** Why a file whose rows name no git blob is not known, whatever its runs ran. */
const UNKEYED: RegionText = { unknown: 'the record was made before its rows named their text by its git blob, so which text ran is not known' };

/**
 * Over which text each test file of `index` ran each region, for the record at
 * `record` made at `recorded`, against the checkout at `root` as the source
 * index's `names` name its files, or why there is no index to name them.
 * Never throws: what cannot be read is not known, with the reason, and so is
 * every region run when there is no index.
 */
export async function textOver(
  root: string,
  record: string,
  recorded: string | undefined,
  index: ExecutionIndex,
  names: IndexNames | { readonly missed: string },
): Promise<TextOf> {
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

  // Only a call the count asks about is read for: a load or a case run over another text is not run.
  const placedOf = new Map<string, readonly (readonly [string, TestPlace])[]>();
  for (const [file, tests] of textAsks(index)) {
    placedOf.set(file, [...tests].flatMap((test) => {
      const place = places.get(test);
      return place === undefined || place.assumed === true ? [] : [[test, place] as const];
    }));
  }
  const cuts = rowCuts(record, index, new Set(placedOf.keys()));
  const noIndex = 'missed' in names ? { unknown: `which text ran is not known: ${names.missed}` } : undefined;
  const over = 'missed' in names
    ? new Map<string, ReadonlyMap<string, readonly Edit[] | RegionText>>()
    : await overTexts(root, record, cuts, names, placedOf, [...places.values()], read.repository, recorded, read.runs?.latest);
  return (file, region, test) => {
    const place = places.get(test);
    if (place === undefined || place.assumed === true) return nowhere;
    const cut = cuts.get(file);
    if (cut !== undefined && !('unknown' in cut) && cut.blob === undefined) return UNKEYED;
    if (noIndex !== undefined) return noIndex;
    const ran = over.get(file)?.get(test);
    if (ran === undefined) return 'this';
    return Array.isArray(ran) ? (regionTouched(region, ran) ? 'older' : 'this') : ran as RegionText;
  };
}

/**
 * Per file, then per test file, what the test file's run ran the file over: the
 * edits from the text its regions are numbered in to the checkout's, or the
 * answer for every region of it.
 */
type Over = ReadonlyMap<string, ReadonlyMap<string, readonly Edit[] | RegionText>>;

/**
 * For each file of `placedOf` and each test file placed that called into it,
 * the edits from the text the record's rows were cut from, through the text
 * the run ran, to the one the checkout holds, each text named: the rows by
 * their git blob, the checkout's by the source index's, a run's by `ranOver`'s
 * evidence. Two texts of one name are no edit and are not read; the others are
 * read, the checkout's from disk, to be diffed.
 */
async function overTexts(
  root: string,
  record: string,
  cuts: ReadonlyMap<string, RowsCut>,
  names: IndexNames,
  placedOf: ReadonlyMap<string, readonly (readonly [string, TestPlace])[]>,
  places: readonly TestPlace[],
  repository: string | undefined,
  recorded: string | undefined,
  latest: string | undefined,
): Promise<Over> {
  const over = new Map<string, ReadonlyMap<string, readonly Edit[] | RegionText>>();
  const held = new Map<string, HeldNames>();
  for (const file of placedOf.keys()) {
    const cut = cuts.get(file);
    const now = names.get(file);
    if (cut === undefined || 'unknown' in cut || cut.blob === undefined || now === undefined) continue;
    held.set(file, { blob: now, digest: cut.blob === now ? cut.digest : undefined });
  }
  const evidence: Evidence = await evidenceOf(places, held, {
    root, snapshot: record, repository, last: recorded === undefined ? latest : undefined, region: true, placement: undefined, ranOther: undefined,
    ...(recorded === undefined ? {} : { at: [recorded] }),
  });
  const kept = keptTexts(root);
  for (const [file, placed] of placedOf) {
    const cut = cuts.get(file);
    const now = names.get(file);
    if (cut !== undefined && !('unknown' in cut) && cut.blob === undefined) continue;
    const answer: (test: string, place: TestPlace) => readonly Edit[] | RegionText = cut === undefined || 'unknown' in cut
      ? () => cut ?? { unknown: `the record holds no digest of the text of ${file} its regions were cut from` }
      : now === undefined
        ? () => 'older' as const
        : await chains(file, { name: cut.blob!, digest: cut.digest }, now, held.get(file)!);
    over.set(file, new Map(placed.map(([test, place]) => [test, answer(test, place)] as const)));
  }
  return over;

  /** The chain each run of `file` ran along, from the rows' text through the run's to the checkout's `now`, read once per text. */
  async function chains(file: string, rows: { readonly name: string; readonly digest: string }, now: string, names: HeldNames) {
    let checkout: NamedText | Unknown | undefined;
    const atNow = async (): Promise<NamedText | Unknown> => {
      try {
        return { name: now, text: await readFile(resolve(root, file), 'utf8') };
      } catch (error) {
        return { unknown: `${file} does not read: ${error instanceof Error ? error.message : String(error)}` };
      }
    };
    // The rows' text by its name: the checkout's, a commit's that holds it, or one a landing kept.
    const atRows = async (): Promise<NamedText | undefined> => {
      if (rows.name === now) {
        checkout ??= await atNow();
        return 'text' in checkout ? checkout : undefined;
      }
      for (const [commit, blobs] of evidence.blobs) {
        const text = blobs.get(file) === rows.name ? evidence.committed.get(commit)?.get(file) : undefined;
        if (text !== undefined) return { name: rows.name, text };
      }
      const text = kept(rows.digest);
      return text === undefined ? undefined : { name: rows.name, text };
    };
    const along = new Map<string, readonly Edit[] | RegionText>();
    const result = new Map<TestPlace, readonly Edit[] | RegionText>();
    for (const [test, place] of placedOf.get(file)!) {
      const ran = ranOver(place, test, file, names, evidence, false);
      if (ran === 'absent') result.set(place, 'older');
      else if (typeof ran === 'object' && 'unknown' in ran) result.set(place, ran);
      else if (ran !== 'held' && ran.rows !== true && (ran.text === undefined || ran.name === undefined)) {
        result.set(place, { unknown: `the text of ${file} that run ran over is neither kept nor committed` });
      } else {
        const ranName = ran === 'held' ? now : ran.rows === true ? rows.name : ran.name!;
        let chain = along.get(ranName);
        if (chain === undefined) {
          chain = await chainOf(ranName, ran === 'held' || ran.rows === true ? undefined : ran.text);
          along.set(ranName, chain);
        }
        result.set(place, chain);
      }
    }
    return (_test: string, place: TestPlace) => result.get(place)!;

    async function chainOf(ranName: string, ranText: string | undefined): Promise<readonly Edit[] | RegionText> {
      // One name all along is one text: nothing is read.
      if (rows.name === now && ranName === now) return [];
      checkout ??= await atNow();
      if ('unknown' in checkout) return checkout;
      const atNowText = checkout;
      const from = await atRows();
      const ranAt = ranName === now ? atNowText : ranName === rows.name ? from : ranText === undefined ? undefined : { name: ranName, text: ranText };
      if (from === undefined || ranAt === undefined) return { unknown: `a text of ${file} the record or a run names cannot be found` };
      return [evidence.edit(file, from, ranAt), evidence.edit(file, ranAt, atNowText)];
    }
  }
}

/** The text the record's rows were cut from of each asked file ({@link rowsCut}), every one not known when the record does not read. */
function rowCuts(record: string, index: ExecutionIndex, asked: ReadonlySet<string>): ReadonlyMap<string, RowsCut> {
  try {
    return rowsCut(record, asked, index);
  } catch (error) {
    const unknown = { unknown: `the record's rows do not read: ${error instanceof Error ? error.message : String(error)}` };
    return new Map([...asked].map((file) => [file, unknown]));
  }
}
