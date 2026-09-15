import type { TestState, VantageState, WatchedTest } from '@variance-authority/vantage';
import { heading, tally, unattached } from './vantage-lines.js';
import type { Tool } from './tool.js';

/**
 * What the suite is doing, right now.
 *
 * The listing an agent reads before it asks about one test. Ordered as the run
 * opened them, because the useful reading of a suite in flight is chronological
 * — the test that is hanging is the last one with an arrow next to it — and
 * newest-first would put the answer at the top and the story in reverse.
 */
export const runSignals: Tool<VantageState> = {
  name: 'variance_run_signals',
  description:
    'What the running test suite is doing now: every test that has reported, its state, and how much each has announced. Not limited to visual tests.',
  inputSchema: {
    type: 'object',
    properties: {
      state: {
        type: 'string',
        enum: ['running', 'passed', 'failed', 'timedOut', 'skipped', 'interrupted'],
        description: 'Show only tests in this state.',
      },
      file: { type: 'string', description: 'Show only tests whose spec file contains this.' },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'How many of the most recent to list. Defaults to 50.',
      },
    },
    additionalProperties: false,
  },
  run(state, input) {
    if (state.tests.length === 0) return unattached(state);

    const wanted = stateArg(input);
    const file = fileArg(input);
    const matching = state.tests.filter(
      (test) =>
        (wanted === undefined || test.state === wanted) &&
        (file === undefined || test.file.includes(file)),
    );
    if (matching.length === 0) return nothingMatched(state, wanted, file);

    const limit = limitArg(input);
    const shown = matching.slice(Math.max(0, matching.length - limit));
    const elided = matching.length - shown.length;

    return [
      summary(state, matching),
      '',
      ...shown.map(row),
      ...(elided === 0 ? [] : ['', `… ${elided} earlier match(es) not listed; raise \`limit\`.`]),
      ...(state.forgotten === 0
        ? []
        : ['', `${state.forgotten} earlier test(s) were dropped to keep this watcher bounded.`]),
    ].join('\n');
  },
};

function summary(state: VantageState, matching: readonly WatchedTest[]): string {
  const counted = new Map<TestState, number>();
  for (const test of matching) counted.set(test.state, (counted.get(test.state) ?? 0) + 1);
  const breakdown = [...counted]
    .sort((left, right) => right[1] - left[1])
    .map(([one, count]) => `${count} ${one}`)
    .join(', ');
  const where = state.address === undefined ? '' : ` at ${state.address}`;
  return `${matching.length} test(s)${where} — ${breakdown}.`;
}

function row(test: WatchedTest): string {
  // A stopped test is still running, so the arrow stays; what changes is the
  // word, because a reader watching for movement needs to know none is coming
  // until they ask for it.
  const mark = test.state === 'running' ? '▸' : ' ';
  const state = test.waitingAt === undefined ? test.state : 'waiting';
  const lines = [`${mark} ${state.padEnd(11)} ${heading(test)} — ${tally(test)}`];
  if (test.waitingAt !== undefined) lines.push(`      stopped at ${test.waitingAt}`);
  if (test.error !== undefined) {
    lines.push(...test.error.split('\n').map((line) => `      ${line}`));
  }
  return lines.join('\n');
}

function nothingMatched(
  state: VantageState,
  wanted: TestState | undefined,
  file: string | undefined,
): string {
  const asked = [
    ...(wanted === undefined ? [] : [`state ${wanted}`]),
    ...(file === undefined ? [] : [`file containing ${file}`]),
  ].join(' and ');
  const states = [...new Set(state.tests.map((test) => test.state))].sort().join(', ');
  return `No test here matches ${asked}. ${state.tests.length} test(s) have reported, in: ${states}.`;
}

const STATES = new Set<string>([
  'running',
  'passed',
  'failed',
  'timedOut',
  'skipped',
  'interrupted',
]);

function stateArg(input: Readonly<Record<string, unknown>>): TestState | undefined {
  const value = input['state'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !STATES.has(value)) {
    throw new Error(`\`state\` must be one of: ${[...STATES].join(', ')}`);
  }
  return value as TestState;
}

function fileArg(input: Readonly<Record<string, unknown>>): string | undefined {
  const value = input['file'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new Error('`file` must be a non-empty string');
  }
  return value;
}

function limitArg(input: Readonly<Record<string, unknown>>): number {
  const value = input['limit'];
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error('`limit` must be a positive integer');
  }
  return value as number;
}
