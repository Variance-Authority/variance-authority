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
import { codeUnitOrder } from '@variance-authority/core/segment';
import {
  coveringTestsInFile,
  functionsUnder,
  lastRunsOf,
  ranOver,
  testPlaces,
  type CasesLastRan,
  type ExecutionIndex,
  type ExecutionTest,
  type NotHeld,
  type Placement,
  type TestPlace,
} from '@variance-authority/sense/test-selection';
import type { RunsRead } from './record-runs.js';
import { evidenceOf, regionVerdict, type Evidence, type Region } from './covering-ran-evidence.js';
import { listedIn } from './covering-where.js';
import type { CoveringTarget } from './covering.js';
import { heldAsPrecondition, type HeldAsPrecondition } from './held-as-precondition.js';

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
   * The later runs that ran them only in part and may have run what they are
   * read for, earliest first, each with when it landed when the record holds
   * it: every one when no case of them is named, since each wrote some of their
   * lines, else those that do not say which cases they laid. Absent when none did.
   */
  readonly partly?: readonly { readonly commit?: string; readonly landed?: Landed }[];
  /**
   * Under `--since`, the changed files on disk they are judged on, in the
   * diff's order, when that is not every one: the files their cases are named
   * for, that they entered, or that they hold as a precondition. A run's texts
   * name only the files it read, so a file their runs never loaded says
   * nothing of the text they ran over, and is not judged. Absent when they are
   * judged on every asked file, and with no verdict when on none.
   */
  readonly files?: readonly string[];
  /**
   * `held` when they ran over the asked text of every file they are judged
   * on, `other` when they ran over another text of the files in `other`, or
   * over none of those in `absent`, which did not exist where they ran. Absent
   * when no text was held to compare, or when neither is so of any file and
   * `unknown` says why.
   */
  readonly text?: 'held' | 'other';
  readonly other?: readonly string[];
  readonly absent?: readonly string[];
  /** When not every file they are judged on holds the text they ran over: those that do. */
  readonly held?: readonly string[];
  /** Why whether they ran over the asked text of each file they are judged on not in `held`, `other` or `absent` is not known. */
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

/**
 * What one reading of the runs says of an answer: where and when the test
 * files it names last ran, and, when it asked lines the record has no place
 * for, whether a case that entered the file ran over a text holding each;
 * absent when no case's text of the file is known.
 */
export interface RanRead {
  readonly ran?: CoveringRan;
  readonly ranOver?: (held: number) => boolean;
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
  /** In the held text: the asked lines the record has no place for. */
  readonly unplaced?: readonly number[];
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
  const named = [...new Set(listed.map((test) => test.file).concat(holding))].sort(codeUnitOrder);
  if (named.length > 0 || index === undefined) return { tests: named, cases: casesOf(listed) };
  const entered = answer.file === undefined ? [] : coveringTestsInFile(index, answer.file).flatMap((range) => range.tests);
  if (entered.length > 0) return { tests: [...new Set(entered.map((test) => test.file))].sort(codeUnitOrder), named: 'entered', cases: casesOf(entered) };
  const read = [...new Set(index.tests.map((test) => test.file))].sort(codeUnitOrder);
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
 * said part by part; `covering-fresh-text.ts` says it. The same evidence
 * says which unplaced lines a case ran over the text of (`textsHolding`).
 */
export async function ranOf(answer: RanNamed, question: RanQuestion): Promise<RanRead> {
  const { tests, named, cases } = namedTestFiles(answer, question.index);
  if (tests.length === 0) return {};
  const as = named === undefined ? {} : { named };
  const { snapshot, at } = question;
  if (snapshot === undefined) return { ran: { tests, unread: 'the record names no commit', ...as } };
  const read = await question.runs();
  if (read.unread !== undefined) return { ran: { tests, unread: read.unread.message, ...as } };
  const { places, assumed } = testPlaces({ commit: at, runs: read.runs, tests });
  const asked = answer.changed?.map((change) => change.file) ?? (answer.file === undefined ? [] : [answer.file]);
  const held = await heldTexts(question, answer, asked);
  const unheld = answer.changed === undefined ? [] : asked.filter((file) => !held.has(file));
  const units = tests.flatMap((test) => unitsOf(places.get(test)!, test, cases.get(test)));
  const precondition = answer.preconditionOf !== undefined;
  // A precondition has no recorded line, so no region of it is compared.
  const region = precondition ? undefined : regionOf(answer, question);
  // Under `--since` a test file that read a changed file only as a precondition is judged on it as one.
  const holding = answer.changed === undefined || held.size === 0 ? undefined : heldAsPrecondition(snapshot, [...held.keys()], held);
  const readers = readersOf(answer, { tests, named, index: question.index, holding });
  const judged = (test: string): Judged => new Map([...held].flatMap(([file, text]) => {
    const as = readers.get(test)?.get(file);
    return as === undefined ? [] : [[file, { text, precondition: as === 'precondition' }] as const];
  }));
  const writers = enteredUnits(answer, question, (entered) => testPlaces({ commit: at, runs: read.runs, tests: entered }).places);
  const evidence = held.size === 0
    ? undefined
    : await evidenceOf([...units, ...writers].flatMap((unit) => unit.runs), held, {
      root: question.root,
      snapshot,
      repository: read.repository,
      last: at === undefined ? read.runs?.latest : undefined,
      region: region !== undefined,
      placement: question.placement,
      ranOther: question.ranOther ?? holding?.ranOther,
    });
  const stands = standsOf(units, (unit) => (evidence === undefined ? {} : verdictOf(unit, judged(unit.test), held.size, evidence, region)));
  // Oldest first, by when their runs first landed; a stand the record holds no time for comes first.
  stands.sort((one, other) => codeUnitOrder(one.landed?.first ?? '', other.landed?.first ?? ''));
  const ran = { stands, ...(assumed === undefined ? {} : { assumed }), ...(unheld.length === 0 ? {} : { unheld }), ...as };
  const fileText = answer.file === undefined ? undefined : held.get(answer.file);
  const ranOver = evidence === undefined || fileText === undefined || writers.length === 0
    ? undefined
    : textsHolding(writers, answer.file!, fileText, evidence);
  return { ran, ...(ranOver === undefined ? {} : { ranOver }) };
}

/**
 * The units of every case that entered the asked file, placed by `place`,
 * when the question asked lines the record has no place for: whether one of
 * them ran a text holding a line says whether the line is new to every case.
 * None otherwise.
 */
function enteredUnits(
  answer: RanNamed,
  question: RanQuestion,
  place: (tests: readonly string[]) => ReadonlyMap<string, TestPlace>,
): readonly Unit[] {
  if ((question.unplaced ?? []).length === 0 || answer.file === undefined) return [];
  const entered = namedTestFiles({ file: answer.file }, question.index);
  if (entered.named !== 'entered') return [];
  const places = place(entered.tests);
  return entered.tests.flatMap((test) => unitsOf(places.get(test)!, test, entered.cases.get(test)));
}

/**
 * Whether a case that entered `file` ran a text holding a line of the held
 * `text`: the held text itself, or another known one where the line is placed
 * unedited. A text that is not known holds no line.
 */
function textsHolding(writers: readonly Unit[], file: string, text: string, evidence: Evidence): (held: number) => boolean {
  const overs = writers.flatMap((unit) => unit.runs.map((run) => ranOver(run, unit.test, file, text, evidence, false)));
  if (overs.includes('held')) return () => true;
  const others = overs.flatMap((over) => (typeof over === 'object' && 'text' in over && over.text !== undefined ? [over.text] : []));
  const places = [...new Set(others)].map((other) => evidence.across(text, other));
  return (line) => places.some((place) => place({ startLine: line, endLine: line })?.moved === false);
}

/** The asked files one test file is judged on, each with its held text and whether the test file holds it as a precondition. */
type Judged = ReadonlyMap<string, { readonly text: string; readonly precondition: boolean }>;

/**
 * The asked files each test file read, by test file, and how: the files its
 * cases are named for or that it entered, else the ones it holds as a
 * precondition. A question about one file is of the file for every test file
 * it names or that entered it; a test file an answer was only read from read
 * none of them.
 */
function readersOf(answer: RanNamed, of: {
  readonly tests: readonly string[];
  readonly named: 'entered' | 'read' | undefined;
  readonly index: ExecutionIndex | undefined;
  readonly holding: HeldAsPrecondition | undefined;
}): ReadonlyMap<string, ReadonlyMap<string, 'entered' | 'precondition'>> {
  const readers = new Map<string, Map<string, 'entered' | 'precondition'>>();
  const add = (test: string, file: string, as: 'entered' | 'precondition') => {
    const files = readers.get(test) ?? new Map<string, 'entered' | 'precondition'>();
    if (files.get(file) !== 'entered') files.set(file, as);
    readers.set(test, files);
  };
  if (answer.changed === undefined) {
    if (answer.file === undefined || of.named === 'read') return readers;
    for (const test of of.tests) add(test, answer.file, answer.preconditionOf === undefined ? 'entered' : 'precondition');
    return readers;
  }
  for (const change of answer.changed) {
    const named = [...change.regions.flatMap((region) => [...region.tests, ...(region.stopped ?? [])]), ...change.cases];
    const entered = of.index === undefined ? [] : coveringTestsInFile(of.index, change.file).flatMap((range) => range.tests);
    for (const test of [...named, ...entered]) add(test.file, change.file, 'entered');
    for (const test of of.holding?.of.get(change.file) ?? []) add(test, change.file, 'precondition');
  }
  return readers;
}

/** Some of one test file's named cases and the runs they may have last run in (`lastRunsOf`). */
interface Unit extends CasesLastRan {
  readonly test: string;
}

/** The named cases of `test`, placed at `place`, grouped by the runs each last ran in: one unit when they all agree. */
function unitsOf(place: TestPlace, test: string, cases: readonly ExecutionTest[] | undefined): readonly Unit[] {
  return lastRunsOf(place, test, cases).map((part) => ({ test, ...part }));
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
  return [...[...together.values()].map((group) => ({ ...standOf(group.runs, [...new Set(group.tests)].sort(codeUnitOrder)), ...group.verdict })), ...apart];
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

/** The verdict of one stand: `files`, `text`, `other`, `absent`, `held`, `unknown` and `region` of {@link RanStand}. */
type Verdict = Pick<RanStand, 'files' | 'text' | 'other' | 'absent' | 'held' | 'unknown' | 'region'>;

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
 * One unit's verdict for each file it is judged on, its held text against the
 * text each run its cases may have last run in ran over (`ranOver`). Every
 * file is said: one whose text is not known hides no other's verdict, and none
 * hides it. `asked` is how many asked files are held, so `files` is named only
 * when the unit is judged on fewer.
 */
function verdictOf(unit: Unit, judged: Judged, asked: number, evidence: Evidence, region: Region): Verdict {
  if (judged.size === 0) return {};
  const files = judged.size === asked ? {} : { files: [...judged.keys()] };
  const same: string[] = [];
  const other: string[] = [];
  const absent: string[] = [];
  const unknown: string[] = [];
  let regional: RanStand['region'];
  for (const [file, { text, precondition }] of judged) {
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
      if (judged.size !== 1) continue;
      const overs = rans.filter((ran): ran is NotHeld => ran === 'absent' || (typeof ran === 'object' && 'text' in ran));
      const regions = overs.map((over) => regionVerdict(region, text, over, file, evidence));
      regional = regions.find((one) => typeof one === 'object') ?? (regions.every((one) => one === regions[0]) ? regions[0] : { unknown: apart(file) });
    }
  }
  if (same.length === judged.size) return { ...files, text: 'held' };
  return {
    ...files,
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
