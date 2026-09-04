import type { TestState, VantageState } from '@variance-authority/vantage';
import { attaching, unattached } from './vantage-lines.js';
import { NO_ARGS, type Tool } from './tool.js';

/**
 * The watcher, describing itself.
 *
 * The first question, and the only one whose answer is useful before a suite has
 * been started. Every other live tool answers about the run; this one answers
 * about the thing holding it, which is what a reader needs when the answers are
 * empty and there are two possible reasons — nothing has run, or something ran
 * and reported somewhere else.
 *
 * It exists because a shell reader has no handshake. An MCP client is told the
 * address on the line that starts the server and can see the connection is up;
 * a reader that runs one command, prints, and exits was told nothing and has no
 * connection to look at. This is that line, available at any moment rather than
 * only at the one moment a reader may have missed.
 */
export const self: Tool<VantageState> = {
  name: 'variance_self',
  description:
    'This watcher: where it is listening, whether a run has reported to it yet, and exactly what to start a suite with. Ask first, and ask again when an answer is emptier than expected.',
  inputSchema: NO_ARGS,
  run(state) {
    if (state.tests.length === 0) return unattached(state);

    return [
      held(state),
      ...(state.forgotten === 0
        ? []
        : [`${state.forgotten} earlier test(s) were dropped to keep this watcher bounded.`]),
      '',
      attaching(state),
    ].join('\n');
  },
};

/** What this watcher is holding, by the state each test is in. */
function held(state: VantageState): string {
  const counted = new Map<TestState, number>();
  for (const test of state.tests) counted.set(test.state, (counted.get(test.state) ?? 0) + 1);

  const by = [...counted]
    .sort((one, other) => other[1] - one[1])
    .map(([which, count]) => `${String(count)} ${which}`)
    .join(', ');

  return `Watching ${String(state.tests.length)} test(s): ${by}.`;
}
