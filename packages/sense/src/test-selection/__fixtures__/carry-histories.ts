/**
 * Histories generated from a seed out of the stories' own actions — edits
 * that change nothing a region does, edits that do, runs of some tests over a
 * cut that may lack a callback, and runs of other tests — and checked after
 * every landing against a model kept from the fixture's labels alone.
 *
 * The model never asks the code under test what corresponds to what. Each
 * test's last run says, per label, that the test entered it (`in`), missed it
 * in a cut that held it (`out`), or may be given it by inheritance (`maybe`):
 * the cut lacked the label, or lacked its same-named sibling, and the test
 * entered the region around it. An edit that changes what a region does makes
 * that label `unmeasured` for every test that has not run since: neither
 * required of the record nor forbidden to it. Every check is then a pair of
 * bounds — a required test missing and a test held or selected for nothing
 * both fail.
 *
 * A failing history is shrunk to the fewest actions that still fail, and the
 * error names the seed, the shrunk actions and the kept walk.
 */

import { rm } from 'node:fs/promises';
import { commit, held, keepArtifacts, labelOf, noted, openWalk, owed, regionsOf, runElsewhere, runTests, selected, touching, type Walk } from './carry-contract.js';
import { A, B, C, type Ask } from './carry-stories.js';

const TESTS = [A, B, C] as const;
type Test = typeof TESTS[number];

const LABELS = ['top', 'outer', 'first', 'second', 'body', 'one', 'two'] as const;
type Label = typeof LABELS[number];

/** The labels a comment can be written inside. */
const NOTED = ['top', 'outer', 'first', 'second', 'body'] as const;
type Noted = typeof NOTED[number];

/** The labels a cut may lack: two callbacks given to `useEffect`, the same address. */
const LACKABLE = ['first', 'second'] as const;
type Lackable = typeof LACKABLE[number];

const HITS: Readonly<Record<Test, readonly Label[]>> = {
  [A]: ['top', 'outer', 'first', 'body', 'one'],
  [B]: ['top', 'outer', 'second', 'body', 'two'],
  [C]: ['top'],
};

/** The region each label's region stands in. */
const OWNER: Readonly<Partial<Record<Label, Label>>> = { outer: 'top', first: 'outer', second: 'outer', body: 'top', one: 'body', two: 'body' };

export type Action =
  | { readonly action: 'comment'; readonly in: Noted }
  | { readonly action: 'type' }
  | { readonly action: 'import' }
  | { readonly action: 'delete one' }
  | { readonly action: 'run'; readonly tests: readonly Test[]; readonly lacks?: Lackable }
  | { readonly action: 'run elsewhere' };

/** What the subject's text holds: every action that edits toggles one of these, except `delete one`. */
interface Shape {
  readonly notes: ReadonlySet<Noted>;
  readonly type: boolean;
  readonly imported: boolean;
  readonly one: boolean;
}

/** The subject's text for `shape`: a component with two effects and a function with two branches. */
export function textOf(shape: Shape): string {
  const note = (label: Noted, indent: string): string[] => (shape.notes.has(label) ? [`${indent}// a note in ${label}`] : []);
  return [
    "hit('top');",
    ...note('top', ''),
    ...(shape.type ? ['type Unused = number;'] : []),
    ...(shape.imported ? ["import { elsewhere } from './elsewhere';"] : []),
    'export function component(a: number, b: number) {',
    "  hit('outer');",
    ...note('outer', '  '),
    '  useEffect(() => {',
    ...note('first', '    '),
    "    hit('first');",
    '  }, [a]);',
    '  useEffect(() => {',
    ...note('second', '    '),
    "    hit('second');",
    '  }, [b]);',
    '}',
    'export function f(x: number) {',
    ...note('body', '  '),
    "  hit('body');",
    ...(shape.one ? ['  if (x === 1) {', "    hit('one');", '  }'] : []),
    '  if (x === 2) {',
    "    hit('two');",
    '  }',
    '}',
    '',
  ].join('\n');
}

const FIRST: Shape = { notes: new Set(), type: false, imported: false, one: true };

function edited(shape: Shape, action: Action): Shape {
  switch (action.action) {
    case 'comment': {
      const notes = new Set(shape.notes);
      if (!notes.delete(action.in)) notes.add(action.in);
      return { ...shape, notes };
    }
    case 'type': return { ...shape, type: !shape.type };
    case 'import': return { ...shape, imported: !shape.imported };
    case 'delete one': return { ...shape, one: false };
    default: return shape;
  }
}

function labelsOf(shape: Shape): readonly Label[] {
  return LABELS.filter((label) => label !== 'one' || shape.one);
}

/**
 * The labels an edit from `from` to `to` reaches. Its reading is one per file:
 * an import toggled changes what the module does as it loads (`load`, which
 * spares nothing), a deleted branch changes a function's body (`bodies`, which
 * spares the top level), and anything else changes nothing (`none`). Under a
 * reading that spares a kind, a region of that kind is not reached; under one
 * that does not, the region the edit is in is reached, and so is every region
 * whose own text changed — a comment written in it as well.
 */
function reachedBetween(from: Shape, to: Shape): readonly Label[] {
  const reading = from.imported !== to.imported ? 'load' : from.one && !to.one ? 'bodies' : 'none';
  if (reading === 'none') return [];
  const before = textsOf(textOf(from));
  const after = textsOf(textOf(to));
  const moved = LABELS.filter((label) => label !== 'top' && after.has(label) && before.get(label) !== after.get(label));
  return [...new Set<Label>([reading === 'load' ? 'top' : 'body', ...moved])];
}

/** The text of each labelled region of `text`, by label. */
function textsOf(text: string): ReadonlyMap<Label, string> {
  const lines = text.split('\n');
  const regions = regionsOf(text);
  const out = new Map<Label, string>();
  for (const [at, region] of regions.entries()) {
    const label = labelOf(regions, at) as Label | undefined;
    if (label !== undefined && region.block.startLine !== undefined) {
      out.set(label, lines.slice(region.block.startLine - 1, region.block.endLine).join('\n'));
    }
  }
  return out;
}

type State = 'in' | 'out' | 'maybe';

/** What the record may hold, kept from the fixture's labels and the actions alone. */
class Model {
  /** Per test, per label, what its last run says; absent until it ran. */
  private readonly states = new Map<Test, Map<Label, State>>();
  /** Per test, the labels an edit changed since it last ran. */
  private readonly unmeasured = new Map<Test, Set<Label>>();
  /** The shape at the last landing. */
  private landed: Shape = FIRST;

  constructor(public shape: Shape) {}

  /** A landing of `tests` (none for a run elsewhere) over the shape now. */
  land(tests: readonly Test[], lacks: Lackable | undefined): void {
    const reached = reachedBetween(this.landed, this.shape);
    for (const test of TESTS) {
      if (tests.includes(test) || !this.states.has(test)) continue;
      const set = this.unmeasured.get(test) ?? new Set();
      for (const label of reached) set.add(label);
      this.unmeasured.set(test, set);
    }
    for (const test of tests) {
      const states = new Map<Label, State>();
      for (const label of labelsOf(this.shape)) {
        const ambiguous = lacks !== undefined && (LACKABLE as readonly string[]).includes(label);
        const around = HITS[test].includes(OWNER[label] ?? label);
        states.set(label, HITS[test].includes(label) ? 'in' : ambiguous && around ? 'maybe' : 'out');
      }
      this.states.set(test, states);
      this.unmeasured.delete(test);
    }
    // The record holds one cut: a cut that lacks a callback leaves every test's
    // standing at both callbacks to the region around them, until it runs again
    // over a cut that holds both.
    if (lacks !== undefined) {
      for (const [test, states] of this.states) {
        if (tests.includes(test) || !HITS[test].includes('outer')) continue;
        for (const label of LACKABLE) if (states.get(label) === 'out') states.set(label, 'maybe');
      }
    }
    // Deleting the first branch renumbers the second: its region pairs with
    // nothing and takes the function around it, until its tests run again.
    if (this.landed.one && !this.shape.one) {
      for (const [test, states] of this.states) {
        if (!tests.includes(test) && HITS[test].includes('body') && states.get('two') === 'out') states.set('two', 'maybe');
      }
    }
    this.landed = this.shape;
  }

  /** Whether the record measures `test` at `label`: it ran, and nothing changed the label since. */
  private measured(test: Test, label: Label): boolean {
    return this.states.has(test) && this.unmeasured.get(test)?.has(label) !== true;
  }

  /** The tests the record must hold at `label`, and those it may. */
  bounds(label: Label): { readonly must: readonly Test[]; readonly may: readonly Test[] } {
    const of = (wanted: readonly State[]): Test[] =>
      TESTS.filter((test) => this.measured(test, label) && wanted.includes(this.states.get(test)!.get(label) ?? 'out'));
    return { must: of(['in']), may: of(['in', 'maybe']) };
  }

  /** Tests whose standing at `label` is not measured: left out of every comparison there. */
  ignored(label: Label): readonly Test[] {
    return TESTS.filter((test) => !this.measured(test, label));
  }

  /** The tests the record must owe a run, and those it may. */
  owed(): { readonly must: readonly Test[]; readonly may: readonly Test[] } {
    const of = (wanted: readonly State[]): Test[] => TESTS.filter((test) =>
      [...this.unmeasured.get(test) ?? []].some((label) => wanted.includes(this.states.get(test)!.get(label) ?? 'out')));
    return { must: of(['in']), may: of(['in', 'maybe']) };
  }

  /** Tests that ran and are measured at the top level: those that loaded the module. */
  loaded(): readonly Test[] {
    return TESTS.filter((test) => this.measured(test, 'top'));
  }
}

/** One bound check: what is missing from `actual` and what it holds beyond what it may. */
function bound(
  walk: Walk,
  failures: string[],
  name: string,
  actual: readonly string[] | undefined,
  must: readonly string[],
  may: readonly string[],
  ignored: readonly string[],
): void {
  const seen = (actual ?? []).filter((test) => !ignored.includes(test));
  const missing = must.filter((test) => !ignored.includes(test) && !seen.includes(test));
  const unnecessary = seen.filter((test) => !may.includes(test));
  noted(walk, name, { missing, unnecessary, actual: actual ?? null }, { missing: [], unnecessary: [], must, may, ignored });
  if (missing.length > 0) failures.push(`${name}: missing ${missing.join(', ')}`);
  if (unnecessary.length > 0) failures.push(`${name}: unnecessary ${unnecessary.join(', ')}`);
}

/** Every check after a landing, against the model; the failures, empty when the record is within bounds. */
async function checkpoint(walk: Walk, model: Model, step: number, ask: Ask, asked: readonly Label[] | undefined): Promise<string[]> {
  const failures: string[] = [];
  const at = `after action ${step}`;
  const owes = model.owed();
  const owing = await owed(walk);
  bound(walk, failures, `${at}: owed`, owing, owes.must, owes.may, []);
  // A test the record owes a run, rightly, runs on every selection: its standing anywhere is unmeasured.
  const running = owes.may.filter((test) => owing.includes(test));
  const ignoredAt = (label: Label): readonly Test[] => [...new Set([...model.ignored(label), ...running])];
  const record = await held(walk);
  for (const label of labelsOf(model.shape)) {
    const { must, may } = model.bounds(label);
    const ignored = ignoredAt(label);
    // A region the record does not hold — a callback its cut lacked — is answered by selection.
    if (record.cases[label] !== undefined) bound(walk, failures, `${at}: cases at ${label}`, record.cases[label], must, may, ignored);
    if (record.rows[label] !== undefined) bound(walk, failures, `${at}: rows at ${label}`, record.rows[label], must, may, ignored);
  }
  bound(walk, failures, `${at}: loaded by`, record.loadedBy, model.loaded(), model.loaded(), ignoredAt('top'));
  for (const label of labelsOf(model.shape)) {
    const { must, may } = model.bounds(label);
    const reader = asked === undefined || asked.includes(label) ? ask : selected;
    bound(walk, failures, `${at}: an edit in ${label}`, await reader(walk, touching(walk.text, label)), must, may, ignoredAt(label));
  }
  return failures;
}

/** Plays `actions` over a fresh walk; the walk, and the failures of the first checkpoint that had any. */
async function play(actions: readonly Action[], ask: Ask, asked?: readonly Label[]): Promise<{ readonly walk: Walk; readonly failures: readonly string[] }> {
  const model = new Model(FIRST);
  const walk = await openWalk(textOf(FIRST), HITS);
  await runTests(walk, TESTS);
  model.land(TESTS, undefined);
  const played = isLanding(actions.at(-1)) ? actions : [...actions, { action: 'run elsewhere' } as const];
  for (const [step, action] of played.entries()) {
    if (action.action === 'run' || action.action === 'run elsewhere') {
      if (action.action === 'run') await runTests(walk, action.tests, action.lacks === undefined ? {} : { lacks: [action.lacks] });
      else await runElsewhere(walk);
      model.land(action.action === 'run' ? action.tests : [], action.action === 'run' ? action.lacks : undefined);
      const last = step === played.length - 1;
      // The reader under test is asked at the last landing; every earlier one is asked in-process.
      const failures = await checkpoint(walk, model, step, last ? ask : selected, last ? asked : undefined);
      if (failures.length > 0) return { walk, failures };
    } else {
      model.shape = edited(model.shape, action);
      await commit(walk, textOf(model.shape), JSON.stringify(action));
    }
  }
  return { walk, failures: [] };
}

/** The failures `actions` meets when played, empty when it stays within bounds; its walk is removed. */
export async function failuresOf(actions: readonly Action[], ask: Ask): Promise<readonly string[]> {
  const { walk, failures } = await play(actions, ask);
  await rm(walk.scratch, { recursive: true, force: true });
  return failures;
}

function isLanding(action: Action | undefined): boolean {
  return action?.action === 'run' || action?.action === 'run elsewhere';
}

/** A seeded generator: mulberry32. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** The history a seed names: up to `length` actions after the first full run. */
export function historyOf(seed: number, length = 8): readonly Action[] {
  const next = random(seed);
  const pick = <T>(of: readonly T[]): T => of[Math.floor(next() * of.length)]!;
  const count = 2 + Math.floor(next() * (length - 1));
  return Array.from({ length: count }, (): Action => {
    const roll = next();
    if (roll < 0.35) return { action: 'comment', in: pick(NOTED) };
    if (roll < 0.43) return { action: 'type' };
    if (roll < 0.5) return { action: 'import' };
    if (roll < 0.56) return { action: 'delete one' };
    if (roll < 0.78) {
      const tests = TESTS.filter(() => next() < 0.6);
      const lacks = next() < 0.4 ? pick(LACKABLE) : undefined;
      return { action: 'run', tests: tests.length === 0 ? [pick(TESTS)] : tests, ...(lacks === undefined ? {} : { lacks }) };
    }
    return { action: 'run elsewhere' };
  });
}

/** Every history one step smaller than `actions`: an action dropped, a test dropped from a run, a lack dropped. */
function smaller(actions: readonly Action[]): readonly (readonly Action[])[] {
  const out: Action[][] = [];
  for (let at = 0; at < actions.length; at += 1) out.push(actions.filter((_, other) => other !== at));
  for (const [at, action] of actions.entries()) {
    if (action.action !== 'run') continue;
    const replace = (by: Action): Action[] => actions.map((one, other) => (other === at ? by : one));
    if (action.lacks !== undefined) out.push(replace({ action: 'run', tests: action.tests }));
    for (const test of action.tests.length > 1 ? action.tests : []) {
      out.push(replace({ ...action, tests: action.tests.filter((one) => one !== test) }));
    }
  }
  return out;
}

/** How a generated history is asked and how far a failing one is shrunk. */
export interface Generation {
  /** The labels the last selection is asked for; every label when absent. */
  readonly asked?: readonly Label[];
  /**
   * Replays a failing history may spend on shrinking: a count, so a failure is
   * reported the same on every machine and inside the test's own time. An
   * investigation raises it with `CARRY_SHRINK`, under `--testTimeout=0`.
   */
  readonly replays: number;
}

/** A generated history that failed, shrunk, with the walk of its shrunk form kept. */
export class FailedHistory extends Error {
  constructor(
    readonly seed: number,
    /** How many actions the seed's history had. */
    readonly original: number,
    readonly actions: readonly Action[],
    readonly failures: readonly string[],
    /** The kept walk's directory: its repository, its cache with the record, and `artifacts`. */
    readonly kept: string,
    /** Whether shrinking stopped because its replays ran out, before every smaller history was tried. */
    readonly exhausted: boolean,
  ) {
    super([
      `the history of seed ${seed} fails (replay it with CARRY_SEED=${seed}); shrunk from ${original} actions to ${actions.length}${exhausted ? ' before its replays ran out (raise CARRY_SHRINK)' : ''}:`,
      JSON.stringify(actions, null, 2),
      ...failures,
      `the walk is kept at ${kept}`,
    ].join('\n'));
  }
}

/**
 * Plays the history `seed` names and, when it fails, shrinks it toward the
 * fewest actions that still fail, within its replays, and throws a
 * {@link FailedHistory} naming the seed, the shrunk actions and the kept walk
 * of the shrunk history.
 */
export async function generated(seed: number, ask: Ask, { asked, replays }: Generation): Promise<void> {
  let actions = historyOf(seed);
  let outcome = await play(actions, ask, asked);
  if (outcome.failures.length === 0) {
    await rm(outcome.walk.scratch, { recursive: true, force: true });
    return;
  }
  const original = actions.length;
  let budget = Number(process.env['CARRY_SHRINK'] ?? replays);
  let exhausted = false;
  for (let shrunk = true; shrunk && !exhausted;) {
    shrunk = false;
    for (const candidate of smaller(actions)) {
      if (budget === 0) {
        exhausted = true;
        break;
      }
      budget -= 1;
      const tried = await play(candidate, ask, asked);
      if (tried.failures.length === 0) {
        await rm(tried.walk.scratch, { recursive: true, force: true });
        continue;
      }
      await rm(outcome.walk.scratch, { recursive: true, force: true });
      actions = candidate;
      outcome = tried;
      shrunk = true;
      break;
    }
  }
  throw new FailedHistory(seed, original, actions, outcome.failures, await keepArtifacts(outcome.walk), exhausted);
}

/**
 * The seed the contract plays, fixed so a run is reproducible, and chosen as
 * the one of seeds 4830-4869 whose history every fault a seed catches fails: a
 * carry that reads lines only, one that pairs regions blind to their
 * population, and one that refuses the top level, in TypeScript and in the
 * native layer. `CARRY_SEED` replays another, which is how a search for new
 * faults widens past it.
 */
export const CONTRACT_SEED = 4839;

/** The seeds a run plays: `CARRY_SEED` alone when it is set, else `seeds`. */
export function seedsOr(seeds: readonly number[]): readonly number[] {
  const one = process.env['CARRY_SEED'];
  return one === undefined ? seeds : [Number(one)];
}
