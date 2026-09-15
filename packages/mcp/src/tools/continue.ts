import type { VantageState } from '@variance-authority/vantage';
import type { Tool } from './tool.js';

/**
 * Let a stopped test go on.
 *
 * The only tool in this package that changes anything, and a factory for exactly
 * that reason: every other tool is a pure function from something already read
 * to text, and `subject` here is a snapshot with no way back to the process that
 * took it. Rather than widen {@link Tool} so one tool can mutate, the one thing
 * this needs — the ability to release — is closed over at the point the server
 * is wired, which is the point that has it.
 *
 * Not in `VANTAGE_TOOLS`, and therefore not offered by `variance ask`. That is
 * not an omission: a CLI process holds no run, so there is nothing in it to
 * release, and a shell command that reported success while nothing moved would
 * be worse than a missing one.
 */
export interface Releasing {
  /** Tell one stopped test to go on. `false` if it was not stopped. */
  readonly release: (test: string) => boolean;
  /** Tell everything stopped to go on, and answer which tests those were. */
  readonly releaseAll: () => readonly string[];
}

export function continuing(releasing: Releasing): Tool<VantageState> {
  return {
    name: 'variance_continue',
    description:
      'Tell a test that stopped at `variance.observe()` to go on. With no argument, releases every test that is waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        test: {
          type: 'string',
          description:
            'A test id from variance_waiting. Omit to release everything that is waiting.',
        },
      },
      additionalProperties: false,
    },
    run(state, input) {
      const asked = input['test'];
      if (asked !== undefined && (typeof asked !== 'string' || asked === '')) {
        throw new Error('`test` must be a non-empty string');
      }

      if (asked === undefined) {
        const released = releasing.releaseAll();
        if (released.length === 0) return nothingWaiting(state);
        return `Released ${released.length} test(s): ${released.join(', ')}.`;
      }

      const found = state.tests.find((test) => test.id === asked);
      if (found === undefined) {
        return `No test here has the id ${asked}. Ask \`variance_waiting\` for the ones that are stopped.`;
      }
      if (!releasing.release(asked)) {
        // Told rather than silently succeeding, because the two ways this
        // happens — a test that never stopped, and one already let go — both
        // mean the reader is looking at a listing older than the run.
        return `${found.title} [${asked}] is not waiting; nothing to release. It is ${found.state}.`;
      }
      return `Released ${found.title} [${asked}] from ${found.waitingAt}.`;
    },
  };
}

function nothingWaiting(state: VantageState): string {
  return `Nothing was waiting. ${state.tests.length} test(s) have reported here.`;
}
