// compass: variance-authority.reach
/**
 * Where and when the test files a `covering` answer names last ran, and
 * whether they ran over the asked text: how fresh and how actual the answer is.
 * The runs record beside the snapshot says where each test file last ran, when
 * that run landed, and which texts it ran over off its commit (`testPlaces`).
 * Locality is by digest at the question's grain: the file, or the asked line or
 * function across the two texts. Nothing here walks history or counts commits.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  coveringTestsInFile,
  functionsUnder,
  testPlaces,
  type ExecutionIndex,
  type ExecutionTest,
  type Placement,
  type TestPlace,
} from '@variance-authority/sense/test-selection';
import type { RunsRead } from './base-diff.js';
import { evidenceOf, ranOver, regionVerdict, type Evidence, type NotHeld, type Region } from './covering-ran-evidence.js';
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
  /**
   * The names of the cases of its one test file this stand holds, when that
   * file's named cases last ran in different runs, so it is said part by part.
   */
  readonly cases?: readonly string[];
  /** Absent when the record holds no time for them. */
  readonly landed?: Landed;
  /**
   * The later runs that ran them only in part and do not say which cases,
   * earliest first, each with when it landed when the record holds it: some
   * of their cases may be those runs'. Absent when none did.
   */
  readonly partly?: readonly { readonly commit?: string; readonly landed?: Landed }[];
  /**
   * `held` when they ran over the asked text of every asked file, `other`
   * when they ran over another text of the files in `other`, or over none of
   * those in `absent`, which did not exist where they ran. Absent when no text
   * was held to compare, or when neither is so of any file and `unknown` says
   * why.
   */
  readonly text?: 'held' | 'other';
  readonly other?: readonly string[];
  readonly absent?: readonly string[];
  /** When not every asked file's text is the one they ran over: those whose is. */
  readonly held?: readonly string[];
  /** Why whether they ran over the asked text of each asked file not in `held`, `other` or `absent` is not known. */
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
  | {
    readonly stands: readonly RanStand[];
    readonly assumed?: string;
    /**
     * Under `--since`, the changed files not on disk, so no text of them is
     * held and none is compared; a question about one file says it in the
     * answer's own `unheld`.
     */
    readonly unheld?: readonly string[];
  }
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

/**
 * The test files an answer names, or, when it names none, the ones it is dated
 * by instead, with the cases of each it names or is dated by: a case is dated
 * by the run that last ran it.
 */
export function namedTestFiles(answer: RanNamed, index: ExecutionIndex | undefined): {
  readonly tests: readonly string[];
  readonly named?: 'entered' | 'read';
  readonly cases: ReadonlyMap<string, readonly ExecutionTest[]>;
} {
  const stopped = [...(answer.stopped ?? []), ...(answer.changed ?? []).flatMap((file) => file.regions.flatMap((region) => region.stopped ?? []))];
  const holding = answer.preconditionOf ?? [];
  const listed = [...listedIn(answer), ...stopped, ...(index?.tests ?? []).filter((test) => holding.includes(test.file))];
  const named = unique(listed.map((test) => test.file).concat(holding));
  if (named.length > 0 || index === undefined) return { tests: named, cases: casesOf(listed) };
  const entered = answer.file === undefined ? [] : coveringTestsInFile(index, answer.file).flatMap((range) => range.tests);
  if (entered.length > 0) return { tests: unique(entered.map((test) => test.file)), named: 'entered', cases: casesOf(entered) };
  const read = unique(index.tests.map((test) => test.file));
  return read.length === 0 ? { tests: [], cases: new Map() } : { tests: read, named: 'read', cases: casesOf(index.tests) };
}

/** Each case once, by its test file. */
function casesOf(tests: readonly ExecutionTest[]): ReadonlyMap<string, readonly ExecutionTest[]> {
  const cases = new Map<string, Map<string, ExecutionTest>>();
  for (const test of tests) cases.set(test.file, (cases.get(test.file) ?? new Map<string, ExecutionTest>()).set(test.id, test));
  return new Map([...cases].map(([file, byId]) => [file, [...byId.values()]]));
}

/**
 * Where, when and over which text the test files `answer` names last ran;
 * absent when it names none. It does every read: the runs record, once and
 * shared with the motion reading, the held texts, and the evidence of which
 * text each run ran over (`covering-ran-evidence.ts`). Each named case is read
 * from the run that last ran it, so a test file a later run ran in part is
 * said part by part; `covering-fresh-text.ts` says it.
 */
export async function ranOf(answer: RanNamed, question: RanQuestion): Promise<CoveringRan | undefined> {
  const { tests, named, cases } = namedTestFiles(answer, question.index);
  if (tests.length === 0) return undefined;
  const as = named === undefined ? {} : { named };
  const { snapshot, at } = question;
  if (snapshot === undefined) return { tests, unread: 'the record names no commit', ...as };
  const read = await question.runs();
  if (read.unread !== undefined) return { tests, unread: read.unread.message, ...as };
  const { places, assumed } = testPlaces({ commit: at, runs: read.runs, tests });
  const asked = answer.changed?.map((change) => change.file) ?? (answer.file === undefined ? [] : [answer.file]);
  const held = await heldTexts(question, answer, asked);
  const unheld = answer.changed === undefined ? [] : asked.filter((file) => !held.has(file));
  const units = tests.flatMap((test) => unitsOf(places.get(test)!, test, cases.get(test)));
  const precondition = answer.preconditionOf !== undefined;
  // A precondition has no recorded line, so no region of it is compared.
  const region = precondition ? undefined : regionOf(answer, question);
  const evidence = held.size === 0
    ? undefined
    : await evidenceOf(units.flatMap((unit) => unit.runs), held, {
      root: question.root,
      snapshot,
      repository: read.repository,
      last: at === undefined ? read.runs?.latest : undefined,
      region: region !== undefined,
      placement: question.placement,
      ranOther: question.ranOther,
    });
  const stands = standsOf(units, (unit) => (evidence === undefined ? {} : verdictOf(unit, held, evidence, region, precondition)));
  // Oldest first, by when their runs first landed; a stand the record holds no time for comes first.
  stands.sort((one, other) => (one.landed?.first ?? '').localeCompare(other.landed?.first ?? ''));
  return { stands, ...(assumed === undefined ? {} : { assumed }), ...(unheld.length === 0 ? {} : { unheld }), ...as };
}

/**
 * Some of one test file's named cases and the runs they may have last run in:
 * the one that last ran them, then each later run that ran the file in part
 * without naming which cases. `cases`, by name, when the file's named cases
 * last ran apart, so the file is said part by part.
 */
interface Unit {
  readonly test: string;
  readonly runs: readonly TestPlace[];
  readonly cases?: readonly string[];
}

/** The named cases of `test`, placed at `place`, grouped by the runs each last ran in: one unit when they all agree. */
function unitsOf(place: TestPlace, test: string, cases: readonly ExecutionTest[] | undefined): readonly Unit[] {
  const runs = runsOf(place);
  if (place.partly === undefined || cases === undefined || cases.length === 0) return [{ test, runs }];
  const groups = new Map<string, { readonly runs: readonly TestPlace[]; readonly cases: string[] }>();
  for (const one of cases) {
    const last = lastRanIn(place, test, one.id);
    const key = last.map((run) => runs.indexOf(run)).join(' ');
    const group = groups.get(key) ?? { runs: last, cases: [] };
    group.cases.push(one.name);
    groups.set(key, group);
  }
  const parts = [...groups.values()];
  if (parts.length === 1) return [{ test, runs: parts[0]!.runs }];
  return parts.map((part) => ({ test, runs: part.runs, cases: unique(part.cases) }));
}

/**
 * The runs case `id` of `test` may have last run in: the latest that names it
 * among the cases it ran, else the one that last finished the file, then each
 * later run that ran the file in part and does not say which of its cases.
 */
function lastRanIn(place: TestPlace, test: string, id: string): readonly TestPlace[] {
  const maybe: TestPlace[] = [];
  for (const part of [...(place.partly ?? [])].reverse()) {
    const ran = part.cases?.[test];
    if (ran === undefined) maybe.unshift(part);
    else if (ran.includes(id)) return [part, ...maybe];
  }
  return [place, ...maybe];
}

/**
 * One stand per runs and verdict, its test files in code-unit order; a part of
 * a test file whose cases ran apart is a stand of its own. Runs are told apart
 * by what the record says of them, so test files placed alike stand together.
 */
function standsOf(units: readonly Unit[], verdict: (unit: Unit) => Verdict): RanStand[] {
  const together = new Map<string, { readonly runs: readonly TestPlace[]; readonly verdict: Verdict; readonly tests: string[] }>();
  const apart: RanStand[] = [];
  for (const unit of units) {
    const its = verdict(unit);
    if (unit.cases !== undefined) {
      apart.push({ ...standOf(unit.runs, [unit.test]), cases: unit.cases, ...its });
      continue;
    }
    const key = JSON.stringify([unit.runs.map((run) => [run.commit, run.assumed, run.first, run.latest, run.runs, run.texts]), its]);
    const group = together.get(key) ?? { runs: unit.runs, verdict: its, tests: [] };
    group.tests.push(unit.test);
    together.set(key, group);
  }
  return [...[...together.values()].map((group) => ({ ...standOf(group.runs, unique(group.tests)), ...group.verdict })), ...apart];
}

/** Where and when `tests` last ran: the run that last ran their cases, and the later runs in part that may have. */
function standOf(runs: readonly TestPlace[], tests: readonly string[]): RanStand {
  const [place, ...later] = runs as [TestPlace, ...TestPlace[]];
  return {
    ...commitOf(place),
    ...(place.assumed === true ? { assumed: true as const } : {}),
    tests,
    ...landedOf(place),
    ...(later.length === 0 ? {} : { partly: later.map((part) => ({ ...commitOf(part), ...landedOf(part) })) }),
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

/** The verdict of one stand: `text`, `other`, `absent`, `held`, `unknown` and `region` of {@link RanStand}. */
type Verdict = Pick<RanStand, 'text' | 'other' | 'absent' | 'held' | 'unknown' | 'region'>;

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

/**
 * One unit's verdict for each asked file, its held text against the text each
 * run its cases may have last run in ran over (`ranOver`). Every file is said:
 * one whose text is not known hides no other's verdict, and none hides it.
 */
function verdictOf(unit: Unit, held: ReadonlyMap<string, string>, evidence: Evidence, region: Region, precondition: boolean): Verdict {
  const same: string[] = [];
  const other: string[] = [];
  const absent: string[] = [];
  const unknown: string[] = [];
  let regional: RanStand['region'];
  for (const [file, text] of held) {
    const rans = unit.runs.map((run) => ranOver(run, unit.test, file, text, evidence, precondition));
    const unread = rans.flatMap((ran) => (typeof ran === 'object' && 'unknown' in ran ? [ran.unknown] : []));
    if (unread.length > 0) unknown.push(unread[0]!);
    else if (rans.every((ran) => ran === 'held')) same.push(file);
    // A later run in part that does not say which cases it ran holds some of the
    // file's cases, so runs that ran over the asked text and runs that did not
    // leave no text its cases ran over.
    else if (rans.some((ran) => ran === 'held')) unknown.push(apart(file));
    else if (rans.every((ran) => ran === 'absent')) absent.push(file);
    else {
      other.push(file);
      if (held.size !== 1) continue;
      const overs = rans.filter((ran): ran is NotHeld => ran === 'absent' || (typeof ran === 'object' && 'text' in ran));
      const regions = overs.map((over) => regionVerdict(region, text, over, file));
      regional = regions.find((one) => typeof one === 'object') ?? (regions.every((one) => one === regions[0]) ? regions[0] : { unknown: apart(file) });
    }
  }
  if (same.length === held.size) return { text: 'held' };
  return {
    ...(other.length > 0 || absent.length > 0 ? { text: 'other' as const } : {}),
    ...(same.length === 0 ? {} : { held: same }),
    ...(other.length === 0 ? {} : { other }),
    ...(absent.length === 0 ? {} : { absent }),
    ...(regional === undefined ? {} : { region: regional }),
    ...(unknown.length === 0 ? {} : { unknown: [...new Set(unknown)].join('; ') }),
  };
}

/** Why a test file's runs ran over different texts of `file` leave its cases' text not known. */
function apart(file: string): string {
  return `its cases ran in runs over different texts of ${file}, and the runs record does not say which case ran in which`;
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
