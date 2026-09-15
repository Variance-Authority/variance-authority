import type { VantageState, WatchedTest } from '@variance-authority/vantage';
import { stringArg, type Tool } from './tool.js';
import { announcement, heading, notesOf, unattached } from './vantage-lines.js';

/**
 * Everything one test has announced, in order, whatever realm said it.
 *
 * This is the answer a timeout cannot give from outside the worker. A test that
 * is hanging has usually heard *something*, and which realm stopped talking is
 * the whole of the diagnosis: nothing at all means no listener or no `vae` call,
 * and a page that spoke while a service did not means the request never reached
 * the service or never came back.
 *
 * Asked while the test is still running, which is the point. The answer is a
 * snapshot and says so.
 */
export const testSignals: Tool<VantageState> = {
  name: 'variance_test_signals',
  description:
    'Everything one test has announced, in order, with the realm that said each — plus work that started and never ended. Answers while the test is still running.',
  inputSchema: {
    type: 'object',
    properties: {
      test: {
        type: 'string',
        description: 'A test id from variance_run_signals, or part of its title.',
      },
    },
    required: ['test'],
    additionalProperties: false,
  },
  run(state, input) {
    if (state.tests.length === 0) return unattached(state);
    const asked = stringArg(input, 'test');
    const found = locate(state, asked);
    return typeof found === 'string' ? found : described(found);
  },
};

/** The one test meant, or the sentence explaining why it is not one test. */
function locate(state: VantageState, asked: string): WatchedTest | string {
  const byId = state.tests.find((test) => test.id === asked);
  if (byId !== undefined) return byId;

  const byTitle = state.tests.filter((test) => test.title === asked);
  if (byTitle.length === 1 && byTitle[0] !== undefined) return byTitle[0];

  const lowered = asked.toLowerCase();
  const partial = state.tests.filter((test) => test.title.toLowerCase().includes(lowered));
  if (partial.length === 1 && partial[0] !== undefined) return partial[0];
  if (partial.length === 0) {
    return [
      `No test here matches ${asked}. ${state.tests.length} test(s) have reported:`,
      ...state.tests.map((test) => `  ${test.title} [${test.id}]`),
    ].join('\n');
  }
  return [
    `${partial.length} tests match ${asked}; ask for one by id:`,
    ...partial.map((test) => `  ${test.title} [${test.id}]`),
  ].join('\n');
}

function described(test: WatchedTest): string {
  return [
    `${heading(test)} — ${test.state}`,
    '',
    ...heard(test),
    ...pending(test),
    ...remarks(test),
    ...notes(test),
    ...ended(test),
  ].join('\n');
}

function heard(test: WatchedTest): string[] {
  if (test.heard.length === 0) {
    return [
      'Nothing has been announced in this execution, by any realm. Either no ' +
        'listener is installed for it — the test destructures no `events` ' +
        'fixture — or the code it drives does not call `vae` yet.',
    ];
  }
  return [
    test.forgotten === 0
      ? 'Heard, in order:'
      : `Heard, in order (the first ${test.forgotten} were dropped to stay bounded):`,
    ...test.heard.map((event) => `  ${announcement(event)}`),
  ];
}

function pending(test: WatchedTest): string[] {
  if (test.pending.length === 0) return [];
  return [
    '',
    'Started and never ended:',
    ...test.pending.map(
      (event) => `  ${event.realm}  ${event.location} / ${event.subject} / ${event.action}`,
    ),
  ];
}

function remarks(test: WatchedTest): string[] {
  if (test.remarks.length === 0) return [];
  return ['', 'The listener also knows:', ...test.remarks.map((line) => `  ${line}`)];
}

function notes(test: WatchedTest): string[] {
  const lines = notesOf(test);
  if (lines.length === 0) return [];
  return ['', `The test itself ${lines[0]}`, ...lines.slice(1).map((line) => `  ${line}`)];
}

function ended(test: WatchedTest): string[] {
  if (test.waitingAt !== undefined) {
    // Said before the state, because a reader who does not know a test is
    // stopped reads "running" and waits for it to move.
    return [
      '',
      `Stopped at ${test.waitingAt}, waiting to be told to continue. Release it ` +
        'with `variance_continue`.',
    ];
  }
  if (test.state === 'running') return ['', 'Still running; this is where it had got to.'];
  if (test.error === undefined) return ['', `Ended: ${test.state}.`];
  return ['', `Ended: ${test.state}.`, ...test.error.split('\n').map((line) => `  ${line}`)];
}
