// compass: variance-authority.reach
/**
 * `variance select --format explain`: the selection `plain` makes, read for
 * the agent deciding how far to test.
 *
 * One block per hop count the change travelled, nearest first, each with its
 * test files, their recorded seconds and the `--at-distance` command that runs
 * exactly that block. The hops are the leg's (`select-leg.ts`) and the seconds
 * the budget's (`select-budget.ts`): this reads both, and decides nothing.
 * A selection that ran the whole suite says why, and what the record times it at.
 */

import { durationText } from '@variance-authority/core/shard';
import type { SuiteTimes, TestDistance } from '@variance-authority/sense/test-selection';
import { quoted } from '../direct-call.js';
import { many } from './prose-counts.js';
import { timesOf } from './select-budget.js';
import type { SuiteReading, SuiteRequest } from './select-suite.js';
import { selectionNotes, type TestSelection } from './select.js';

/** The open leg: it cuts nothing and measures every hop. */
const OPEN = { from: 0, to: Number.MAX_SAFE_INTEGER } as const;

/** The explanation on stdout, and the selection's notes on stderr. */
export async function explainedOutput(
  request: SuiteRequest,
  select: (request: SuiteRequest) => Promise<SuiteReading>,
): Promise<{ readonly out: string; readonly err: string }> {
  // A journey file has no graph to measure hops on, and a leg beside it is refused.
  const measured = request.atDistance === undefined && request.execution === undefined ? { ...request, atDistance: OPEN } : request;
  const { reading, whole } = await select(measured);
  return { out: explainOf(reading, whole, await timesOf(request), commandOf(request)), err: selectionNotes(reading) };
}

/** One hop count's tests, or the tests no hop placed. */
interface Block {
  readonly hops?: number;
  readonly range: string;
  readonly tests: readonly string[];
}

/** The explanation of `selection` over the record's `whole`, priced by `times`; `command` runs it. */
export function explainOf(selection: TestSelection, whole: ReadonlySet<string>, times: SuiteTimes, command: string): string {
  const recorded = 'unread' in times ? new Map<string, number>() : times.times;
  const unread = unreadOf(selection);
  if (selection.widened !== undefined) {
    const total = [...recorded.values()].reduce((sum, ms) => sum + ms, 0);
    const priced = 'unread' in times ? `the record times no test file: ${times.unread}` : `the record times ${many(recorded.size, 'test file')}, ${durationText(total)}`;
    return [`the whole suite runs: ${selection.widened}.\n${priced}\n`, ...unread].join('\n');
  }

  const skip = new Set(selection.skip);
  const runs = (test: string) => !skip.has(test) && (selection.only === undefined || selection.only.includes(test));
  const distances = (selection.distances ?? []).filter((distance) => runs(distance.test));
  const placed = new Set(distances.map((distance) => distance.test));
  const unplaced = [...new Set([...whole, ...(selection.incomplete ?? [])])].filter((test) => runs(test) && !placed.has(test)).sort();
  const selected = [...placed, ...unplaced];
  const total = selected.reduce((sum, test) => sum + (recorded.get(test) ?? 0), 0);
  const of = selection.recorded === undefined ? '' : ` of ${selection.recorded.whole} recorded`;
  const head = `the change selects ${selected.length}${of} test file${selected.length === 1 ? '' : 's'}, ${durationText(total)} recorded.`;

  const byTest = new Map(distances.map((distance) => [distance.test, distance] as const));
  const lines = (tests: readonly string[]) => tests.map((test) => `  ${test}, ${priceOf(recorded, test)}: ${pathOf(byTest.get(test))}`);
  const blocks = blocksOf(distances, unplaced, selection.distances !== undefined);
  const said = blocks.map((block) => {
    const untimed = block.tests.filter((test) => !recorded.has(test)).length;
    const seconds = block.tests.reduce((sum, test) => sum + (recorded.get(test) ?? 0), 0);
    const counted = `${many(block.tests.length, 'test file')}, ${durationText(seconds)} recorded${untimed === 0 ? '' : `, ${untimed} with no recorded time`}`;
    const label = block.hops === undefined ? 'unmeasured' : many(block.hops, 'hop');
    return [`${label}: ${counted} — ${command} --at-distance ${block.range}`, ...lines(block.tests)].join('\n');
  });
  const unmeasured = selection.distances === undefined && selected.length > 0
    ? ['no hops were measured, so the selection is one block: the leg says why in the notes on stderr\n']
    : [];
  const left = (selection.left?.length ?? 0) > 0
    ? [`${many(selection.left!.length, 'selected test file')} the leg asked leaves to another leg\n`]
    : [];
  return [`${head}\n`, ...said.map((block) => `${block}\n`), ...unmeasured, ...left, ...unread].join('\n');
}

/**
 * One block per measured hop count, nearest first. The tests no path placed
 * run with the furthest leg, which is open, so they close the last block.
 */
function blocksOf(distances: readonly TestDistance[], unplaced: readonly string[], measured: boolean): readonly Block[] {
  const hops = [...new Set(distances.flatMap((distance) => (distance.hops === undefined ? [] : [distance.hops])))].sort((a, b) => a - b);
  if (!measured || hops.length === 0) {
    const tests = [...distances.map((distance) => distance.test), ...unplaced].sort();
    return tests.length === 0 ? [] : [{ range: '0-', tests }];
  }
  const last = hops.length - 1;
  return hops.map((hop, index) => {
    const at = distances.filter((distance) => distance.hops === hop).map((distance) => distance.test);
    const rest = index === last ? [...distances.filter((distance) => distance.hops === undefined).map((distance) => distance.test), ...unplaced] : [];
    return { hops: hop, range: index === last ? `${hop}-` : `${hop}`, tests: [...at, ...rest].sort() };
  });
}

function priceOf(times: ReadonlyMap<string, number>, test: string): string {
  const ms = times.get(test);
  return ms === undefined ? 'no recorded time' : durationText(ms);
}

/** The trail the change took to the test, or why none was measured. */
function pathOf(distance: TestDistance | undefined): string {
  if (distance?.trail !== undefined && distance.trail.length > 0) return distance.trail.join(' → ');
  return `no measured path (${distance?.because ?? distance?.bearing ?? 'the record did not see it entered'})`;
}

/** The changed files neither the record nor the graph knows, and what brings each into reach. */
function unreadOf(selection: TestSelection): readonly string[] {
  if (selection.unread.length === 0) return [];
  return [
    `${many(selection.unread.length, 'changed file')} the record and the graph know nothing of:\n` +
      selection.unread.map((file) => `  ${file}\n`).join('') +
      'Name each in a `/// <depends>` line of the module that reads it, or in the suite\'s `before` when the suite rests on it before any test imports it.\n',
  ];
}

/** `variance select` with the flags that read this selection, each quoted when the shell would split it. */
function commandOf(request: SuiteRequest): string {
  const flags: [string, string | undefined][] = [
    ['--since', request.since],
    ['--suite', request.suite],
    ['--execution', request.execution],
    ['--diff', request.diff],
    ['--ran-at', request.ranAt],
  ];
  const named = flags.flatMap(([flag, value]) => (value === undefined ? [] : [`${flag} ${quoted(value)}`]));
  const switches = [...(request.local === true ? ['--local'] : []), ...(request.noGit === true ? ['--no-git'] : [])];
  return ['variance select', ...named, ...switches].join(' ');
}
