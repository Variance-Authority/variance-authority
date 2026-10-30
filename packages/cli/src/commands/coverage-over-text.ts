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
 * unchanged since every place that ran it reads no text at all.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { digestString } from '@variance-authority/core/format';
import {
  askCoverageFile,
  casesCutApart,
  editsBetween,
  findModules,
  ranOver,
  regionTouched,
  testPlaces,
  type CountedSuite,
  type Edit,
  type ExecutionIndex,
  type RegionText,
  type TestPlace,
} from '@variance-authority/sense/test-selection';
import { evidenceOf, type Evidence } from './covering-ran-evidence.js';
import { runsOf } from './record-runs.js';

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
  // A run over the commit's text of a file git says has not changed since, under rows
  // at a commit it has not changed since either, ran over this text.
  const unchanged = (place: TestPlace, file: string): boolean =>
    place.commit !== undefined && place.texts !== undefined && place.texts[file] === undefined &&
    changed.get(place.commit)?.has(file) === false && recorded !== undefined && changed.get(recorded)?.has(file) === false;

  const asked = new Set<string>();
  for (const module of index.modules) {
    // Only a call the count asks about is read for: a load or a case run over another text is not run.
    const entered = new Set(module.blocks.flatMap((block) => block.crossings.flatMap((crossing) =>
      crossing.loaded === true || crossing.overwritten === true ? [] : [crossing.test])));
    for (const test of entered) {
      const place = places.get(index.tests[test]?.file ?? '');
      if (place !== undefined && place.assumed !== true && !unchanged(place, module.file)) asked.add(module.file);
    }
  }
  const texts = await readTexts(root, record, index, asked, [...places.values()], read.repository, recorded, read.runs?.latest);
  return (file, region, test) => {
    const place = places.get(test);
    if (place === undefined || place.assumed === true) return nowhere;
    if (!asked.has(file)) return 'this';
    return texts(file, place, test, region);
  };
}

/** The verdict of a region of a file whose text is read, by the place its test stood at. */
type Read = (file: string, place: TestPlace, test: string, region: Parameters<TextOf>[1]) => RegionText;

/**
 * Read what the files in `asked` need: their text on disk, the digest the
 * record's rows took of each, and the evidence of which text each run ran over.
 * The edits are read when first asked for, once per pair of texts.
 */
async function readTexts(
  root: string,
  record: string,
  index: ExecutionIndex,
  asked: ReadonlySet<string>,
  places: readonly TestPlace[],
  repository: string | undefined,
  recorded: string | undefined,
  latest: string | undefined,
): Promise<Read> {
  if (asked.size === 0) return () => 'this';
  const held = new Map<string, string>();
  for (const file of asked) {
    const text = await readFile(resolve(root, file), 'utf8').catch(() => undefined);
    if (text !== undefined) held.set(file, text);
  }
  const rows = rowDigests(record, index, asked);
  const evidence: Evidence = await evidenceOf(places, held, {
    root, snapshot: record, repository, last: recorded === undefined ? latest : undefined, region: true, placement: undefined, ranOther: undefined,
  });
  const edits = editsBetween(root, undefined, [recorded, ...places.flatMap((place) => place.commit ?? [])]);
  const chains = new Map<string, readonly Edit[] | RegionText>();
  return (file, place, test, region) => {
    const now = held.get(file);
    // The file is gone from the checkout, so no region of it is this text's.
    if (now === undefined) return 'older';
    const row = rows.get(file);
    if (typeof row !== 'string') return row ?? { unknown: `the record holds no digest of the text of ${file} its regions were cut from` };
    const over = ranOver(place, test, file, now, evidence, false);
    if (over === 'absent') return 'older';
    if (typeof over === 'object' && 'unknown' in over) return over;
    if (typeof over === 'object' && over.text === undefined) return { unknown: `the text of ${file} that run ran over is neither kept nor committed` };
    const ran = over === 'held' ? digestString(now) : digestString(over.text!);
    const key = `${file}\0${ran}`;
    let chain = chains.get(key);
    if (chain === undefined) {
      const along = [edits(file, row, ran), edits(file, ran, digestString(now))];
      chain = along.every((edit) => edit !== undefined)
        ? along as readonly Edit[]
        : { unknown: `a text of ${file} the record or a run names cannot be found` };
      chains.set(key, chain);
    }
    if (!Array.isArray(chain)) return chain as RegionText;
    return regionTouched(region, chain) ? 'older' : 'this';
  };
}

/**
 * The digest the record's rows took of each asked file: the text its index's
 * lines are in. A file the index was cut apart from, or held in rows of two
 * texts, is not known.
 */
function rowDigests(record: string, index: ExecutionIndex, asked: ReadonlySet<string>): ReadonlyMap<string, string | { readonly unknown: string }> {
  try {
    const apart = casesCutApart(record, index.modules.filter((module) => asked.has(module.file)));
    return askCoverageFile(record, (coverage) => {
      const digests = new Map<string, string | { readonly unknown: string }>();
      for (const file of asked) {
        const held = new Set(findModules(coverage, file).map((row) => coverage.string(coverage.moduleSource.at(row))));
        if (apart.has(file)) digests.set(file, { unknown: `the record's case index of ${file} was cut from another text than its rows` });
        else if (held.size > 1) digests.set(file, { unknown: `the record holds rows of ${file} from more than one text` });
        else if (held.size === 1) digests.set(file, [...held][0]!);
      }
      return digests;
    });
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
    // `-z`: without it git quotes a path with unusual characters, and a quoted path never matches a recorded name.
    const { stdout } = await promisify(execFile)('git', ['diff', '--name-only', '--no-renames', '--relative', '-z', commit, '--'], { cwd: root, maxBuffer: 1 << 28 });
    const files = new Set(stdout.split('\0').filter((file) => file !== ''));
    return { has: (file) => files.has(file) };
  } catch {
    return { has: () => undefined };
  }
}
