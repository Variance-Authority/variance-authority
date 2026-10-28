// compass: variance-authority.reach
/**
 * Where and when the test files a `covering` answer names last ran, and
 * whether they ran over the asked text, which is how fresh and how actual the
 * answer is for the question.
 *
 * A snapshot names the commit of its latest run, and a partial run is a run:
 * after one, the snapshot stands at a commit most of its tests never ran at.
 * The runs record beside it says where each test last ran, when those runs
 * landed, and which texts they ran over where those were not the commit's
 * (`testPlaces`), so the answer is dated and placed from it, for the test files
 * it names and no others. Locality is by digest at the grain of the question:
 * the file, and for a line or a function, that region of it, read across the
 * two texts. Nothing here walks history or counts commits.
 *
 * `ranOf` reads, and nothing after it does: the runs record (once, shared
 * with the motion reading), the held texts, the committed text at each place,
 * the kept texts the places name, and how the snapshot's lines stand in the
 * held texts. `verdictOf` decides from what it read, and
 * `covering-fresh-text.ts` says it.
 */

import { readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  coveringTestsInFile,
  functionsUnder,
  keptTexts,
  placeAcross,
  placeInTexts,
  testPlaces,
  textsAt,
  type ExecutionIndex,
  type ExecutionTest,
  type HeldLines,
  type Placement,
  type TestPlace,
} from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import type { RunsRead } from './base-diff.js';
import { listedIn } from './covering-where.js';
import type { CoveringTarget } from './covering.js';

/** When the runs a stand's test files last ran in landed, and how many there were when the record says. */
export interface Landed {
  readonly first: string;
  readonly latest: string;
  readonly runs?: number;
}

/** Some of the test files an answer names: where they last ran, when, and over which text. */
export interface RanStand {
  /** The commit they last ran at, or the one read instead with `assumed`; absent for a run outside a checkout. */
  readonly commit?: string;
  /** The runs record does not say where they ran, and `commit` is the fallback. */
  readonly assumed?: true;
  /** In code-unit order. */
  readonly tests: readonly string[];
  /** Absent when the record holds no time for them. */
  readonly landed?: Landed;
  /**
   * The later runs that ran them only in part, earliest first, each with when
   * it landed when the record holds it: their cases those runs ran are those
   * runs', and the rest are this stand's. Absent when none did.
   */
  readonly partly?: readonly { readonly commit?: string; readonly landed?: Landed }[];
  /**
   * `held` when they ran over the asked text of every asked file, `other`
   * when they ran over another text of the files in `other`. Absent when no
   * text was held to compare, or with `unknown`.
   */
  readonly text?: 'held' | 'other';
  readonly other?: readonly string[];
  /** Why whether they ran over the asked text is not known. */
  readonly unknown?: string;
  /**
   * With `other` and an asked line or function: whether it is the same in
   * both texts, `gone` when no block of the function is in the asked text, or
   * why that is not known.
   */
  readonly region?: 'same' | 'changed' | 'gone' | { readonly unknown: string };
}

/**
 * Where the test files an answer names last ran, one stand per place and
 * verdict, oldest first, with `assumed` saying, in the runs record's words,
 * where it could not place some of them. Or, with `unread`, why that is not
 * known. `named` is absent when the answer names the test files; `entered`
 * when it names none and these are the ones that entered the asked file
 * elsewhere, `read` when none did either and these are every test file of the
 * cases the answer was read from.
 */
export type CoveringRan = (
  | { readonly stands: readonly RanStand[]; readonly assumed?: string }
  | { readonly tests: readonly string[]; readonly unread: string }
) & { readonly named?: 'entered' | 'read' };

/**
 * What an answer names that ran: the cases it lists, the cases that stopped
 * before the line, function or changed region, and the test files that hold
 * the file as a precondition.
 */
export interface RanNamed {
  readonly file?: string;
  readonly target?: CoveringTarget;
  readonly tests?: readonly ExecutionTest[];
  readonly ranges?: readonly { readonly tests: readonly ExecutionTest[] }[];
  readonly changed?: readonly {
    readonly file: string;
    readonly regions: readonly { readonly tests: readonly ExecutionTest[]; readonly stopped?: readonly ExecutionTest[] }[];
    readonly cases: readonly ExecutionTest[];
  }[];
  readonly stopped?: readonly ExecutionTest[];
  readonly preconditionOf?: readonly string[];
}

/** What the reading of an answer's freshness is handed. */
export interface RanQuestion {
  readonly root: string;
  /** The snapshot the index was read beside, absent for one handed in by path, which is no record of a commit. */
  readonly snapshot: string | undefined;
  /** The commit the snapshot names, absent for one of a run outside a checkout. */
  readonly at: string | undefined;
  readonly runs: RunsRead;
  /** The asked file's text, from `--text` or disk, under a question about one file; absent when none is held. */
  readonly held?: string;
  /** How the asked file's recorded lines are placed in `held`, for a line or a function. */
  readonly placement?: Placement;
  /**
   * The index the answer was read from, once `--cases`, `--where` and
   * `--read` narrowed it: the test files an answer naming none is dated by,
   * and the asked function's blocks.
   */
  readonly index?: ExecutionIndex;
  /** Under a precondition answer: the test files holding the file that ran another text of it. */
  readonly ranOther?: ReadonlyMap<string, readonly string[]>;
}

/** The test files an answer names, or, when it names none, the ones it is dated by instead. */
export function namedTestFiles(answer: RanNamed, index: ExecutionIndex | undefined): { readonly tests: readonly string[]; readonly named?: 'entered' | 'read' } {
  const stopped = [...(answer.stopped ?? []), ...(answer.changed ?? []).flatMap((file) => file.regions.flatMap((region) => region.stopped ?? []))];
  const named = unique([...listedIn(answer), ...stopped].map((test) => test.file).concat(answer.preconditionOf ?? []));
  if (named.length > 0 || index === undefined) return { tests: named };
  const entered = answer.file === undefined ? [] : unique(coveringTestsInFile(index, answer.file).flatMap((range) => range.tests.map((test) => test.file)));
  if (entered.length > 0) return { tests: entered, named: 'entered' };
  const read = unique(index.tests.map((test) => test.file));
  return read.length === 0 ? { tests: [] } : { tests: read, named: 'read' };
}

/** Where, when and over which text the test files `answer` names last ran; absent when it names none. */
export async function ranOf(answer: RanNamed, question: RanQuestion): Promise<CoveringRan | undefined> {
  const { tests, named } = namedTestFiles(answer, question.index);
  if (tests.length === 0) return undefined;
  const as = named === undefined ? {} : { named };
  const { snapshot, at } = question;
  if (snapshot === undefined) return { tests, unread: 'the record names no commit', ...as };
  const read = await question.runs();
  if (read.unread !== undefined) return { tests, unread: read.unread.message, ...as };
  const { places, assumed } = testPlaces({ commit: at, runs: read.runs, tests });
  const asked = answer.changed?.map((change) => change.file) ?? (answer.file === undefined ? [] : [answer.file]);
  const held = await heldTexts(question, answer, asked);
  const byPlace = new Map<TestPlace, string[]>();
  for (const test of tests) {
    const place = places.get(test)!;
    byPlace.set(place, [...(byPlace.get(place) ?? []), test]);
  }
  const region = regionOf(answer, question);
  const evidence = answer.preconditionOf === undefined && held.size > 0
    ? await evidenceOf([...byPlace.keys()].flatMap(runsOf), held, { ...question, snapshot, repository: read.repository, region: region !== undefined })
    : undefined;
  const stands = [...byPlace].flatMap(([place, group]): RanStand[] => {
    const where = standOf(place, group);
    if (answer.preconditionOf !== undefined) return byPrecondition(where, asked[0]!, held, question.ranOther);
    return [{ ...where, ...(evidence === undefined ? {} : verdictOf(place, held, evidence, at, region)) }];
  });
  // Oldest first, by when their runs first landed; a stand the record holds no time for comes first.
  stands.sort((one, other) => (one.landed?.first ?? '').localeCompare(other.landed?.first ?? ''));
  return { stands, ...(assumed === undefined ? {} : { assumed }), ...as };
}

/** Where and when `group` last ran, as `place` says. */
function standOf(place: TestPlace, group: readonly string[]): RanStand {
  return {
    ...commitOf(place),
    ...(place.assumed === true ? { assumed: true as const } : {}),
    tests: group,
    ...landedOf(place),
    ...(place.partly === undefined ? {} : { partly: place.partly.map((part) => ({ ...commitOf(part), ...landedOf(part) })) }),
  };
}

function commitOf(place: TestPlace): { readonly commit?: string } {
  return place.commit === undefined ? {} : { commit: place.commit };
}

function landedOf(place: TestPlace): { readonly landed?: Landed } {
  if (place.first === undefined || place.latest === undefined) return {};
  return { landed: { first: place.first, latest: place.latest, ...(place.runs === undefined ? {} : { runs: place.runs }) } };
}

/** The runs a place's cases came from: the one that last finished its test files, then each that ran them in part since. */
function runsOf(place: TestPlace): readonly TestPlace[] {
  return [place, ...(place.partly ?? [])];
}

/** A precondition's digest is recorded per test file, so its verdict is each test file's own. */
function byPrecondition(where: RanStand, file: string, held: ReadonlyMap<string, string>, ranOther: RanQuestion['ranOther']): RanStand[] {
  if (!held.has(file)) return [where];
  const other = where.tests.filter((test) => ranOther?.get(file)?.includes(test) === true);
  const same = where.tests.filter((test) => !other.includes(test));
  return [
    ...(same.length > 0 ? [{ ...where, tests: same, text: 'held' as const }] : []),
    ...(other.length > 0 ? [{ ...where, tests: other, text: 'other' as const, other: [file] }] : []),
  ];
}

/** The verdict of one stand: `text`, `other`, `unknown` and `region` of {@link RanStand}. */
type Verdict = Pick<RanStand, 'text' | 'other' | 'unknown' | 'region'>;

/**
 * The asked region of the held text, in its lines: the line or lines asked,
 * or the asked function's blocks placed in it, none when an edit removed the
 * function. A function written inside the asked one lies inside its block, so
 * an edit that removed only the inner one moved the outer one, which is placed.
 */
type Region = { readonly held: readonly HeldLines[] } | { readonly unknown: string } | undefined;

function regionOf(answer: RanNamed, question: RanQuestion): Region {
  const target = answer.target;
  if (target === undefined) return undefined;
  if ('line' in target) return { held: [{ startLine: target.line, endLine: target.line }] };
  if ('lines' in target) return { held: [target.lines] };
  const placement = question.placement;
  const module = question.index?.modules.find((candidate) => candidate.file === answer.file);
  if (placement === undefined || module === undefined) return undefined;
  if (placement.frame === 'stale') return { unknown: `the record's lines of ${answer.file!} are not placed in its text as it is now` };
  const blocks = functionsUnder(module.blocks, target.function);
  if (blocks.length === 0) return undefined;
  return { held: blocks.flatMap((block) => placement.place(block)?.lines ?? []) };
}

/** What the verdicts are read from, read once for every place. */
interface Evidence {
  /** Whether the checkout is in a git repository, so a committed text can be read. */
  readonly repository: boolean;
  /** The committed text of each asked file at each place's commit, by the asked name; a file the commit lacks is absent. */
  readonly committed: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The text behind each digest a place names that the record keeps, read when a line or a function is asked. */
  readonly kept: ReadonlyMap<string, string>;
  /** How each asked file's recorded lines stand in its held text, where the snapshot holds an instrumented row of it. */
  readonly placements: ReadonlyMap<string, Placement>;
}

/**
 * A place whose test files ran in the run that wrote the snapshot, so the
 * snapshot's rows are the evidence of which text they ran over: one read by
 * assumption at the snapshot's own commit, and, under a snapshot that names
 * no commit, the one landing its runs record keeps, which is that run's.
 */
function readsTheSnapshot(place: TestPlace, at: string | undefined): boolean {
  return place.texts === undefined && place.commit === at && (place.assumed === true || at === undefined);
}

/**
 * Read what the places' verdicts need: the committed texts at every place,
 * the kept texts the places name when a region is asked, and the snapshot's
 * placements when a place reads the snapshot — the question's own for one
 * file, else read for each held text.
 */
async function evidenceOf(
  places: readonly TestPlace[],
  held: ReadonlyMap<string, string>,
  question: RanQuestion & { readonly snapshot: string; readonly repository: string | undefined; readonly region: boolean },
): Promise<Evidence> {
  const { at, snapshot, repository, root } = question;
  const files = [...held.keys()];
  const committed = new Map<string, Map<string, string>>();
  if (repository !== undefined) {
    const under = relative(await realpath(repository), await realpath(root));
    const repoPath = (file: string): string => (under === '' ? file : join(under, file).split(sep).join('/'));
    const commits = [...new Set(places.flatMap((place) => place.commit ?? []))];
    const blobs = textsAt(repository, new Map(commits.map((commit) => [commit, files.map(repoPath)])));
    for (const commit of commits) {
      const texts = blobs.get(commit);
      committed.set(commit, new Map(files.flatMap((file) => {
        const text = texts?.get(repoPath(file));
        return text === undefined ? [] : [[file, text] as const];
      })));
    }
  }
  const kept = new Map<string, string>();
  if (question.region) {
    const keptText = keptTexts(root);
    for (const digest of new Set(places.flatMap((place) => files.flatMap((file) => place.texts?.[file] ?? [])))) {
      const text = keptText(digest);
      if (text !== undefined) kept.set(digest, text);
    }
  }
  const placements = !places.some((place) => readsTheSnapshot(place, at))
    ? new Map<string, Placement>()
    : question.placement !== undefined && files.length === 1
      ? new Map([[files[0]!, question.placement]])
      : placeInTexts(snapshot, root, held);
  return { repository: repository !== undefined, committed, kept, placements };
}

/**
 * One place's verdict for the asked files, each held text against the text
 * the place's runs ran over: a place whose record names its texts ran over the
 * one it names, else over the committed one; a place the record observed
 * without naming its texts ran over a text it does not know; a place read by
 * assumption ran over the snapshot's own text at the snapshot's commit, and
 * the committed one anywhere else. A place whose text is not known is not
 * known, and no other place is touched by it.
 *
 * A test file a later run ran in part holds cases of each run, case by case,
 * and the runs record does not say which case ran in which. Where those runs
 * ran over one text, or every one of them over another, that is said of the
 * file; where some ran over the asked text and some did not, which text its
 * cases ran over is not known.
 */
function verdictOf(place: TestPlace, held: ReadonlyMap<string, string>, evidence: Evidence, at: string | undefined, region: Region): Verdict {
  const other: string[] = [];
  let unknown: string | undefined;
  let regional: RanStand['region'];
  for (const [file, text] of held) {
    const rans = runsOf(place).map((run) => ranOver(run, file, text, evidence, at));
    const unread = rans.flatMap((ran) => (ran !== 'held' && 'unknown' in ran ? [ran.unknown] : []));
    if (unread.length > 0) {
      unknown ??= unread[0];
      continue;
    }
    const others = rans.flatMap((ran) => (ran !== 'held' && 'text' in ran ? [ran.text] : []));
    if (others.length === 0) continue;
    if (others.length < rans.length) {
      unknown ??= apart(file);
      continue;
    }
    other.push(file);
    if (regional !== undefined || held.size !== 1) continue;
    const regions = others.map((ran) => regionVerdict(region, text, ran, file));
    regional = regions.find((one) => typeof one === 'object') ?? (regions.every((one) => one === regions[0]) ? regions[0] : { unknown: apart(file) });
  }
  if (other.length > 0) return { text: 'other', other, ...(regional === undefined ? {} : { region: regional }) };
  return unknown === undefined ? { text: 'held' } : { unknown };
}

/** Why a test file's runs ran over different texts of `file` leave its cases' text not known. */
function apart(file: string): string {
  return `its cases ran in runs over different texts of ${file}, and the runs record does not say which case ran in which`;
}

/** Whether `place` ran over `text` of `file`, or the text it ran over instead when that is found, or why that is not known. */
function ranOver(place: TestPlace, file: string, text: string, evidence: Evidence, at: string | undefined): 'held' | { readonly text: string | undefined } | { readonly unknown: string } {
  const digest = digestString(text);
  if (readsTheSnapshot(place, at)) {
    const placement = evidence.placements.get(file);
    if (placement === undefined) return { unknown: `the record holds no digest of the text of ${file} it ran over` };
    return placement.frame === 'recorded' ? 'held' : { text: placement.recorded };
  }
  if (place.texts === undefined && place.assumed !== true) {
    return { unknown: `the runs record does not say which text of ${file} its runs there ran over` };
  }
  const committed = place.commit === undefined ? undefined : evidence.committed.get(place.commit)?.get(file);
  const named = place.texts?.[file];
  if (named !== undefined) {
    if (named === digest) return 'held';
    return { text: evidence.kept.get(named) ?? (committed !== undefined && digestString(committed) === named ? committed : undefined) };
  }
  if (committed === undefined) {
    return {
      unknown: place.commit === undefined
        ? `that run stood at no commit, so no committed text of ${file} can be read`
        : evidence.repository
          ? `this clone holds no committed text of ${file} where that run stood`
          : `the checkout is in no git repository, so no committed text of ${file} can be read`,
    };
  }
  return digestString(committed) === digest ? 'held' : { text: committed };
}

/**
 * Whether the asked region of `held` is the same in `ran`, the text a test
 * file ran over; absent when no region is asked, and `gone` when the asked
 * function is not in `held` at all.
 */
function regionVerdict(region: Region, held: string, ran: string | undefined, file: string): RanStand['region'] {
  if (region === undefined || 'unknown' in region) return region;
  if (region.held.length === 0) return 'gone';
  if (ran === undefined) return { unknown: `the text of ${file} that run ran over is neither kept nor committed` };
  const place = placeAcross(held, ran);
  return region.held.every((range) => place(range)?.moved === false) ? 'same' : 'changed';
}

/**
 * The held text of each asked file that has one: the one handed in for a
 * question about one file, each changed file's on disk under `--since`.
 */
async function heldTexts(question: RanQuestion, answer: RanNamed, asked: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const texts = answer.changed === undefined
    ? asked.map((file) => [file, question.held] as const)
    : await Promise.all(asked.map(async (file) => [file, await readFile(resolve(question.root, file), 'utf8').catch(() => undefined)] as const));
  return new Map(texts.flatMap(([file, text]) => (text === undefined ? [] : [[file, text] as const])));
}

function unique(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort();
}
