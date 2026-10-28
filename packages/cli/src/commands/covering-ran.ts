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
 * The reading is the shell's: it reads the runs record (once, shared with the
 * motion reading), the committed texts and the kept ones. What it found is
 * said by `covering-fresh-text.ts`.
 */

import { readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  coveringTestsInFile,
  functionsUnder,
  keptTexts,
  placeAcross,
  recordedDigests,
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
  /** The commit they last ran at, or the one read instead with `assumed`. */
  readonly commit: string;
  /** The runs record does not say where they ran, and `commit` is the fallback. */
  readonly assumed?: true;
  /** In code-unit order. */
  readonly tests: readonly string[];
  /** Absent when the record holds no time for them. */
  readonly landed?: Landed;
  /**
   * `held` when they ran over the asked text of every asked file, `other`
   * when they ran over another text of the files in `other`. Absent when no
   * text was held to compare, or with `unknown`.
   */
  readonly text?: 'held' | 'other';
  readonly other?: readonly string[];
  /** Why whether they ran over the asked text is not known. */
  readonly unknown?: string;
  /** With `other` and an asked line or function: whether it is the same in both texts, or why that is not known. */
  readonly region?: 'same' | 'changed' | { readonly unknown: string };
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
  /** The snapshot and the commit it names; absent for a record that names none. */
  readonly snapshot: string | undefined;
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
  if (at === undefined || snapshot === undefined) return { tests, unread: 'the record names no commit', ...as };
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
  const verdicts = answer.preconditionOf === undefined
    ? await moduleVerdicts([...byPlace.keys()], { ...question, at, snapshot, repository: read.repository, asked: held, region: regionOf(answer, question) })
    : undefined;
  const stands: RanStand[] = [];
  for (const [place, group] of byPlace) {
    const where: RanStand = {
      commit: place.commit,
      ...(place.assumed === true ? { assumed: true as const } : {}),
      tests: group,
      ...(place.first === undefined || place.latest === undefined
        ? {}
        : { landed: { first: place.first, latest: place.latest, ...(place.runs === undefined ? {} : { runs: place.runs }) } }),
    };
    if (verdicts !== undefined) {
      stands.push({ ...where, ...verdicts.get(place) });
      continue;
    }
    // A precondition's digest is recorded per test file, so its verdict is each test file's own.
    const file = asked[0]!;
    if (held.get(file) === undefined) {
      stands.push(where);
      continue;
    }
    const other = group.filter((test) => question.ranOther?.get(file)?.includes(test) === true);
    const same = group.filter((test) => !other.includes(test));
    if (same.length > 0) stands.push({ ...where, tests: same, text: 'held' });
    if (other.length > 0) stands.push({ ...where, tests: other, text: 'other', other: [file] });
  }
  // Oldest first, by when their runs first landed; a stand the record holds no time for comes first.
  stands.sort((one, other) => (one.landed?.first ?? '').localeCompare(other.landed?.first ?? ''));
  return { stands, ...(assumed === undefined ? {} : { assumed }), ...as };
}

/** The verdict of one stand: `text`, `other`, `unknown` and `region` of {@link RanStand}. */
type Verdict = Pick<RanStand, 'text' | 'other' | 'unknown' | 'region'>;

/** The asked region of the held text, in its lines: the line or lines asked, or the asked function's blocks placed in it. */
type Region = readonly HeldLines[] | { readonly unknown: string } | undefined;

function regionOf(answer: RanNamed, question: RanQuestion): Region {
  const target = answer.target;
  if (target === undefined) return undefined;
  if ('line' in target) return [{ startLine: target.line, endLine: target.line }];
  if ('lines' in target) return [target.lines];
  const placement = question.placement;
  const module = question.index?.modules.find((candidate) => candidate.file === answer.file);
  if (placement === undefined || module === undefined) return undefined;
  if (placement.frame === 'stale') return { unknown: `the record's lines of ${answer.file!} are not placed in its text as it is now` };
  return functionsUnder(module.blocks, target.function).flatMap((block) => {
    const placed = placement.place(block);
    return placed === undefined ? [] : [placed.lines];
  });
}

/**
 * Each place's verdict for the asked module files: the digest of the text it
 * ran over, read as the runs record says — a text it names, else the
 * committed one; for a place the record could not observe, the snapshot's own
 * digest at its commit and the committed text elsewhere — against the held
 * text's. A place whose committed text this clone lacks is not known, and no
 * other place is touched by it.
 */
async function moduleVerdicts(
  places: readonly TestPlace[],
  question: RanQuestion & { readonly at: string; readonly snapshot: string; readonly repository: string | undefined; readonly asked: ReadonlyMap<string, string | undefined>; readonly region: Region },
): Promise<Map<TestPlace, Verdict>> {
  const { at, snapshot, repository, asked: held } = question;
  const files = [...held.keys()].filter((file) => held.get(file) !== undefined);
  const verdicts = new Map<TestPlace, Verdict>(places.map((place) => [place, {}]));
  if (files.length === 0) return verdicts;
  const recorded = places.some((place) => place.assumed === true && place.texts === undefined && place.commit === at) ? recordedDigests(snapshot, files) : new Map<string, string>();
  const under = repository === undefined ? undefined : relative(await realpath(repository), await realpath(question.root));
  const repoPath = (file: string): string => (under === undefined || under === '' ? file : join(under, file).split(sep).join('/'));
  const blobs = repository === undefined
    ? new Map<string, Map<string, string>>()
    : textsAt(repository, new Map(places.map((place) => [place.commit, files.map(repoPath)])));
  const kept = keptTexts(question.root);
  for (const place of places) {
    const other: string[] = [];
    let unknown: string | undefined;
    let region: RanStand['region'];
    for (const file of files) {
      const blob = blobs.get(place.commit)?.get(repoPath(file));
      const digest = digestOf(place, file, blob, at, recorded);
      if (digest === undefined) {
        unknown ??= place.texts === undefined && place.assumed !== true
          ? `the runs record does not say which text of ${file} its runs there ran over`
          : place.texts === undefined && place.commit === at
            ? `the record holds no digest of the text of ${file} it ran over`
            : repository === undefined
              ? `the checkout is in no git repository, so no committed text of ${file} can be read`
              : `this clone holds no committed text of ${file} where that run stood`;
        continue;
      }
      if (digest === digestString(held.get(file)!)) continue;
      other.push(file);
      if (region === undefined && files.length === 1 && question.region !== undefined) {
        const text = kept(digest) ?? (blob !== undefined && digestString(blob) === digest ? blob : undefined);
        region = regionVerdict(question.region, held.get(file)!, text, file);
      }
    }
    verdicts.set(place, other.length > 0
      ? { text: 'other', other, ...(region === undefined ? {} : { region }) }
      : unknown === undefined ? { text: 'held' } : { unknown });
  }
  return verdicts;
}

/**
 * The digest of the text of `file` a place's runs ran over. A place whose
 * record names its texts ran over the one it names, else over the committed
 * one. A place the record observed without naming its texts ran over a text
 * it does not know: nothing is assumed of it. A place read by assumption is
 * read as the snapshot's row at the snapshot's commit, and as the committed
 * text anywhere else.
 */
function digestOf(place: TestPlace, file: string, blob: string | undefined, at: string, recorded: ReadonlyMap<string, string>): string | undefined {
  const committed = blob === undefined ? undefined : digestString(blob);
  if (place.texts !== undefined) return place.texts[file] ?? committed;
  if (place.assumed !== true) return undefined;
  return place.commit === at ? recorded.get(file) : committed;
}

/** Whether the asked region of `held` is the same in `ran`, the text a test file ran over. */
function regionVerdict(region: Region, held: string, ran: string | undefined, file: string): RanStand['region'] {
  if (region === undefined || 'unknown' in region) return region;
  if (ran === undefined) return { unknown: `the text of ${file} that run ran over is neither kept nor committed` };
  const place = placeAcross(held, ran);
  return region.every((range) => place(range)?.moved === false) ? 'same' : 'changed';
}

/** The held text of each asked file: the one handed in for a question about one file, each changed file's on disk under `--since`. */
async function heldTexts(question: RanQuestion, answer: RanNamed, asked: readonly string[]): Promise<ReadonlyMap<string, string | undefined>> {
  if (answer.changed === undefined) return new Map(asked.map((file) => [file, question.held]));
  return new Map(await Promise.all(asked.map(async (file) => [file, await readFile(resolve(question.root, file), 'utf8').catch(() => undefined)] as const)));
}

function unique(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort();
}
