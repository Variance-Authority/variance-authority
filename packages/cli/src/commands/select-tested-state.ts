// compass: variance-authority.reach
/**
 * The reconciliation machine of `variance select --tested`: pure, so every
 * answer it gives can be read off one table.
 *
 * Open states ask for one input each: `asked` the selection without
 * `--tested` (`selected`), `selecting` the merge HEAD holds (`merge`),
 * `merged` what each side's change reaches (`sides`). Any open state may
 * instead be told its input could not be read (`failed`). Every other state
 * is final and keeps whatever it is handed.
 *
 * Invariants: an unsafe or unknown input — HEAD not that merge, a dirty
 * tree, a side that alone selects every test, a read that failed, an input
 * the state did not ask for — lands on `widened`, which selects as
 * without `--tested`. Only `merged` narrows, and only by adding to the
 * skip list, save `ran`: HEAD's clean tree is the tree a named commit ran its
 * selection on, so nothing is left to run on it. The answer is read from the final state alone; an open state
 * answers as without `--tested`, and `declined` says it did nothing.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { many } from './prose-counts.js';
import type { SuiteReading } from './select-suite.js';

/** The two commits a merge queue joined at HEAD, and their merge base. */
export interface Merge {
  readonly mainline: string;
  readonly tested: string;
  readonly fork: string;
}

/** The tests one side reaches: by its code, and by its install. */
export interface Reach {
  readonly code: ReadonlySet<string>;
  readonly install: ReadonlySet<string>;
}

/** What git says HEAD is, against `--since` and `--tested`. */
export type MergeAnswer =
  | { readonly is: 'known'; readonly merge: Merge }
  | { readonly is: 'ran'; readonly at: string }
  | { readonly is: 'apart'; readonly why: string }
  | { readonly is: 'dirty' }
  | { readonly is: 'unknown'; readonly why: string };

/** One side's reach, or why reading it alone selects every test file. */
export type SideAnswer = Reach | { readonly whole: string };

export type TestedInput =
  | { readonly kind: 'selected'; readonly full: SuiteReading }
  | { readonly kind: 'merge'; readonly answer: MergeAnswer }
  | { readonly kind: 'sides'; readonly pull: SideAnswer; readonly main: SideAnswer }
  | { readonly kind: 'failed'; readonly why: string };

/** A test file one side alone reaches, and that side. */
export interface Dropped {
  readonly test: string;
  readonly side: 'mainline' | 'pull request';
}

export type TestedState =
  | { readonly kind: 'asked'; readonly tested: string }
  | { readonly kind: 'selecting'; readonly tested: string; readonly runs: readonly string[] }
  | { readonly kind: 'merged'; readonly tested: string; readonly runs: readonly string[]; readonly merge: Merge }
  | { readonly kind: 'declined'; readonly tested: string; readonly why: string }
  | { readonly kind: 'widened'; readonly tested: string; readonly why: string }
  | { readonly kind: 'kept'; readonly tested: string; readonly merge: Merge; readonly runs: number }
  | { readonly kind: 'ran'; readonly tested: string; readonly at: string }
  | { readonly kind: 'narrowed' | 'empty'; readonly tested: string; readonly merge: Merge; readonly dropped: readonly Dropped[] };

/** The machine before anything is read: `tested` is the commit as asked. */
export function initial(tested: string): TestedState {
  return { kind: 'asked', tested };
}

/** Whether the machine still asks for an input. */
export function isOpen(state: TestedState): state is Extract<TestedState, { kind: 'asked' | 'merged' | 'selecting' }> {
  return state.kind === 'asked' || state.kind === 'selecting' || state.kind === 'merged';
}

/** The state `input` moves `state` to. A final state keeps any input. */
export function transition(state: TestedState, input: TestedInput): TestedState {
  const { tested } = state;
  const unexpected: TestedState = { kind: 'widened', tested, why: `it did not expect a ${input.kind} answer while ${state.kind}` };
  if (isOpen(state) && input.kind === 'failed') return { kind: 'widened', tested, why: input.why };
  switch (state.kind) {
    case 'asked': {
      if (input.kind !== 'selected') return unexpected;
      const { full } = input;
      if (full.reading.ground !== 'read' || full.declined !== undefined) return { kind: 'declined', tested, why: full.declined ?? full.reading.because };
      return { kind: 'selecting', tested, runs: [...full.whole].filter((test) => !full.skip.has(test)) };
    }
    case 'selecting':
      return input.kind === 'merge' ? fromMerge(state, input.answer) : unexpected;
    case 'merged':
      return input.kind === 'sides' ? fromSides(state, input.pull, input.main) : unexpected;
    case 'declined':
    case 'empty':
    case 'kept':
    case 'narrowed':
    case 'ran':
    case 'widened':
      return state;
    default:
      return unreachable(state);
  }
}

function fromMerge(state: Extract<TestedState, { kind: 'selecting' }>, answer: MergeAnswer): TestedState {
  const { tested, runs } = state;
  switch (answer.is) {
    case 'known':
      return { kind: 'merged', tested, runs, merge: answer.merge };
    case 'ran':
      return { kind: 'ran', tested, at: answer.at };
    case 'apart':
    case 'unknown':
      return { kind: 'widened', tested, why: answer.why };
    case 'dirty':
      return { kind: 'widened', tested, why: 'the working tree differs from HEAD' };
    default:
      return unreachable(answer);
  }
}

function fromSides(state: Extract<TestedState, { kind: 'merged' }>, pull: SideAnswer, main: SideAnswer): TestedState {
  const { tested, runs, merge } = state;
  for (const [name, side] of [['pull request', pull], ['mainline', main]] as const) {
    if ('whole' in side) return { kind: 'widened', tested, why: `read alone, the ${name}'s change selects every test file (${side.whole})` };
  }
  const [p, m] = [pull as Reach, main as Reach];
  // An install reaches a test whatever the other side's code does; a test neither side reaches is kept.
  const dropped = runs
    .filter((test) => !p.install.has(test) && !m.install.has(test) && p.code.has(test) !== m.code.has(test))
    .map((test): Dropped => ({ test, side: p.code.has(test) ? 'pull request' : 'mainline' }));
  if (dropped.length === 0) return { kind: 'kept', tested, merge, runs: runs.length };
  return { kind: dropped.length === runs.length ? 'empty' : 'narrowed', tested, merge, dropped };
}

/**
 * The selection a state answers, built on `without`, the selection without
 * `--tested`. Every state but `narrowed`, `empty` and `ran` skips what
 * `without` skips.
 */
export function selectionOf(state: TestedState, without: SuiteReading): SuiteReading {
  const as = (why: string) => withNotes(without, [`\`--tested ${state.tested}\` selects as without it: ${why}`]);
  switch (state.kind) {
    case 'asked':
    case 'merged':
    case 'selecting':
      return without;
    case 'declined':
      return withNotes(without, [`\`--tested ${state.tested}\` did nothing: the selection without it read no record, or already runs every test file (${state.why}), so there is nothing to narrow`]);
    case 'widened':
      return as(state.why);
    case 'kept':
      return withNotes(without, [
        state.runs === 0
          ? `\`--tested ${state.tested}\` skips nothing more: no test file runs without it`
          : `\`--tested ${state.tested}\` skips nothing more: every test file that runs is reached by both sides of the merge, or by neither`,
      ]);
    case 'empty':
    case 'narrowed':
      return narrowed(state, without);
    case 'ran':
      return ran(state, without);
    default:
      return unreachable(state);
  }
}

function narrowed(state: Extract<TestedState, { kind: 'empty' | 'narrowed' }>, without: SuiteReading): SuiteReading {
  const { dropped, merge } = state;
  const [t12, m12] = [merge.tested.slice(0, 12), merge.mainline.slice(0, 12)];
  const notes = [
    `one pull request, tested at ${t12}, meets the mainline at ${m12}, so ${many(dropped.length, 'test file')} only one side reaches ${dropped.length === 1 ? 'is' : 'are'} skipped`,
    ...(state.kind === 'empty' ? ['the pull request and the mainline it meets reach no test in common, so no test file runs'] : []),
    ...dropped.map(({ test, side }) =>
      side === 'pull request'
        ? `${test}: only the pull request reaches it; \`--tested\` names its tree ${t12} as tested`
        : `${test}: only the mainline reaches it; \`--since\` names its tree ${m12} as tested`,
    ),
  ];
  const skip = [...new Set([...without.reading.skip, ...dropped.map(({ test }) => test)])].sort(codeUnitOrder);
  const because =
    `skipping ${many(skip.length, 'test file')}: ${without.reading.skip.length} the selection skips without \`--tested\`, ` +
    `and ${dropped.length} only one side of the merge reaches; every other test file runs`;
  return skipping(without, skip, because, notes);
}

function ran(state: Extract<TestedState, { kind: 'ran' }>, without: SuiteReading): SuiteReading {
  const skip = [...new Set([...without.reading.skip, ...without.whole])].sort(codeUnitOrder);
  const because = `skipping all ${many(skip.length, 'test file')}: HEAD's tree already ran them`;
  return skipping(without, skip, because, [`\`--tested ${state.tested}\` skips every test file: HEAD's tree is the tree ${state.at.slice(0, 12)} ran its selection on`]);
}

/** `without`, skipping `skip` for `because`, with `notes` ahead of its own. */
function skipping(without: SuiteReading, skip: readonly string[], because: string, notes: readonly string[]): SuiteReading {
  const reading = { ...without.reading, skip: [...skip], because, notes: [...notes, ...without.reading.notes] };
  return { ...without, skip: new Set(skip), notes: reading.notes, reading };
}

function withNotes(without: SuiteReading, notes: readonly string[]): SuiteReading {
  const all = [...without.reading.notes, ...notes];
  return { ...without, notes: all, reading: { ...without.reading, notes: all } };
}

function unreachable(value: never): never {
  throw new Error(`the \`--tested\` machine met ${JSON.stringify(value)}`);
}
