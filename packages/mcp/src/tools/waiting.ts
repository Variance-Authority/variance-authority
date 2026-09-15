import type { VantageState, WatchedTest } from '@variance-authority/vantage';
import { heading, notesOf, unattached } from './vantage-lines.js';
import type { Tool } from './tool.js';

/**
 * Which tests have stopped and are waiting to be told to go on.
 *
 * The one question about a live run whose answer is an invitation. Everything
 * else here reports; this says *a test is holding the page still for you*, and
 * what it is holding it at. Separate from `variance_run_signals` because a
 * stopped test is not a sixth state — it is running, and standing still — and
 * burying that in a listing of forty tests is how an agent misses the one that
 * was waiting for it.
 */
export const waiting: Tool<VantageState> = {
  name: 'variance_waiting',
  description:
    'Which running tests have stopped at a `variance.observe()` call and are waiting to be told to continue, where each stopped, and what it sent from there.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run(state) {
    if (state.tests.length === 0) return unattached(state);

    const stopped = state.tests.filter((test) => test.waitingAt !== undefined);
    if (stopped.length === 0) return nothing(state);

    return [
      `${stopped.length} test(s) are waiting to be told to continue.`,
      '',
      ...stopped.flatMap((test) => described(test)),
      '',
      'Look at whatever you need to — the page is held where it is — then call ' +
        '`variance_continue` with one of these ids, or with none to release all ' +
        'of them.',
    ].join('\n');
  },
};

function described(test: WatchedTest): string[] {
  return [
    `  ${heading(test)} [${test.id}]`,
    `    stopped at ${test.waitingAt}`,
    ...notesOf(test).map((line) => `    ${line}`),
    '',
  ];
}

function nothing(state: VantageState): string {
  const running = state.tests.filter((test) => test.state === 'running').length;
  return [
    `Nothing is waiting. ${running} of ${state.tests.length} test(s) here are still running.`,
    '',
    'A test waits only where its author wrote `await variance.observe()`. That ' +
      'call is inert when nobody is watching, so a spec that has one still runs ' +
      'straight through in CI.',
  ].join('\n');
}
