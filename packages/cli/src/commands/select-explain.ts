// compass: variance-authority.reach
/**
 * `variance select --format explain`: the selection `plain` makes, read for
 * the agent deciding how far to test.
 *
 * One block per hop count the change travelled, nearest first, each with its
 * test files, their recorded seconds and the `--at-distance` command that runs
 * exactly that block. The hops are the leg's distances, cut by `atDistance`
 * as a leg cuts them, and the seconds the budget's (`select-budget.ts`): this
 * reads both, and decides nothing.
 * A selection that ran the whole suite says why, and what the record times it at.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { durationText } from '@variance-authority/core/shard';
import { atDistance, groupByDistance, type SuiteTimes, type TestDistance } from '@variance-authority/sense/test-selection';
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

/** The tests one command runs: one hop count's, or those no hop placed. */
interface Block {
  readonly label: string;
  /** The `--at-distance` range that runs exactly this block; absent when the selection measured no hops. */
  readonly range?: string;
  readonly tests: readonly string[];
}

/** The explanation of `selection` over the record's `whole`, priced by `times`; `command` runs it. */
export function explainOf(selection: TestSelection, whole: ReadonlySet<string>, times: SuiteTimes, command: string): string {
  const recorded = 'unread' in times ? new Map<string, number>() : times.times;
  const unread = unreadOf(selection);
  if (selection.widened !== undefined) {
    const total = [...recorded.values()].reduce((sum, ms) => sum + ms, 0);
    const of = whole.size > recorded.size ? ` of ${whole.size}` : '';
    const timed = 'unread' in times ? `the record times no test file: ${times.unread}` : `the record times ${many(recorded.size, 'test file')}${of}, ${durationText(total)}`;
    return [`the whole suite runs: ${selection.widened}.\n${timed}\n`, ...unread].join('\n');
  }

  const skip = new Set(selection.skip);
  const runs = (test: string) => !skip.has(test) && (selection.only === undefined || selection.only.includes(test));
  const blocks = blocksOf(selection, whole, runs);
  const selected = blocks.flatMap((block) => block.tests);
  const of = selection.recorded === undefined ? '' : ` of ${selection.recorded.whole} recorded`;
  const head = `the change selects ${selected.length}${of} test file${selected.length === 1 ? '' : 's'}, ${priced(recorded, selected)}.`;

  const byTest = new Map((selection.distances ?? []).map((distance) => [distance.test, distance] as const));
  const said = blocks.map((block) => {
    const runsIt = block.range === undefined ? command : `${command} --at-distance ${block.range}`;
    const lines = block.tests.map((test) => `  ${test}, ${priceOf(recorded, test)}: ${pathOf(byTest.get(test))}`);
    return [`${block.label}: ${many(block.tests.length, 'test file')}, ${priced(recorded, block.tests)} — ${runsIt}`, ...lines].join('\n');
  });
  const unseen = 'a test file the record never saw, such as one the change adds, is in no skip list, and runs in every block\n';
  const left = (selection.left?.length ?? 0) > 0
    ? [`${many(selection.left!.length, 'selected test file')} the leg asked leaves to another leg\n`]
    : [];
  return [`${head}\n`, ...said.map((block) => `${block}\n`), unseen, ...left, ...unread].join('\n');
}

/**
 * One block per hop count the leg measured, nearest first, each the tests
 * `atDistance` returns for that one hop, so the tests no path placed sit in
 * the block whose leg runs them. A recorded test never seen whole that no hop
 * placed runs in the open leg alone, so its block starts past the furthest
 * hop. With no hops measured, the selection is one block, run as it is.
 */
function blocksOf(selection: TestSelection, whole: ReadonlySet<string>, runs: (test: string) => boolean): readonly Block[] {
  const measured = selection.distances;
  if (measured === undefined) {
    const tests = [...new Set([...whole, ...(selection.incomplete ?? [])])].filter(runs).sort(codeUnitOrder);
    return tests.length === 0 ? [] : [{ label: 'no measured distance', tests }];
  }
  const hops = groupByDistance(measured).flatMap((group) => (group.hops === undefined ? [] : [group.hops]));
  const blocks: Block[] = hops.map((hop) => ({ label: many(hop, 'hop'), range: `${hop}`, tests: atDistance(measured, hop, hop).filter(runs) }));
  const furthest = hops.at(-1);
  const named = new Set(measured.map((distance) => distance.test));
  const open = [
    // With no hop measured, `atDistance` carries the unplaced in the open leg.
    ...(furthest === undefined ? measured.map((distance) => distance.test) : []),
    ...(selection.incomplete ?? []).filter((test) => !named.has(test)),
  ].filter(runs).sort(codeUnitOrder);
  if (open.length > 0) blocks.push({ label: 'no measured distance', range: `${furthest === undefined ? 0 : furthest + 1}-`, tests: open });
  return blocks.filter((block) => block.tests.length > 0);
}

/** The recorded seconds of `tests`, and how many the record holds no time for. */
function priced(times: ReadonlyMap<string, number>, tests: readonly string[]): string {
  const seconds = tests.reduce((sum, test) => sum + (times.get(test) ?? 0), 0);
  const untimed = tests.filter((test) => !times.has(test)).length;
  return `${durationText(seconds)} recorded${untimed === 0 ? '' : `, ${untimed} with no recorded time`}`;
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
