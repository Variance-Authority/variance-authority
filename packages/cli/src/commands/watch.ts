import { VANTAGE_VARIABLE } from '@variance-authority/vantage';
import {
  VANTAGE_ASK,
  attachVantage,
  type VantageReading,
} from '@variance-authority/vantage/attach';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';

/**
 * `variance watch` — hold a run that is still running, for a reader with no
 * client to hold it for them.
 *
 * The live half of what `variance ask` did for reports. A finished run leaves a
 * file, so any number of processes can open it whenever they like; a run in
 * flight leaves nothing, and the only copy of what it said lives in the memory
 * of whatever was listening at the time. That is the whole of the difference
 * between the two halves, and the reason this command exists while `ask` needs
 * no equivalent: somebody has to be listening *before* the suite starts, and
 * until now the only thing that could listen was an MCP server.
 *
 * So this is that process, minus the protocol. It attaches, prints the one line
 * a suite has to be started with, and stays up. What it is holding is readable
 * over the same address the run reports to — see `@variance-authority/vantage`'s
 * `attach` — so `variance ask --at` in another shell reaches it without a second
 * port, a second variable, or a file anywhere.
 *
 * It writes nothing down. Stopping it loses the run, which is the bargain
 * `@variance-authority/vantage` already makes and does not change here: an
 * announcement is a message, not a record, and a watcher that left an artifact
 * behind would be offering evidence it cannot stand behind.
 */

/** What a watcher tells the operator, and what it is waiting to be told. */
export interface Watching {
  readonly address: string;
  /** Settles when the watcher is asked to stop, and not before. */
  readonly until: Promise<void>;
  readonly close: () => Promise<void>;
}

/** The lines a watcher prints before it goes quiet. */
export function watching(address: string): string {
  return [
    'variance-authority is watching. Start the suite with this in its environment:',
    '',
    `  ${VANTAGE_VARIABLE}=${address}`,
    '',
    'Ask it, from any other shell, with the same address:',
    '',
    `  variance ask self --at ${address}`,
    '',
    'It holds the run in memory and writes nothing down. Stop it and the run is gone.',
    '',
  ].join('\n');
}

/**
 * Attach, and stay attached.
 *
 * `until` rather than a callback, because the caller is `dispatch`, whose whole
 * contract is to return an exit code once — a command that blocks is still one
 * that finishes, and this is where it finishes.
 */
export async function watch(): Promise<Watching> {
  const attached = await attachVantage();

  // The wire listener is deliberately `unref`'d: a suite that has finished must
  // not be held open by something watching it. This process is the exception —
  // watching *is* the work — so it holds its own handle rather than asking the
  // medium to stop being polite.
  const held = setInterval(() => {}, 1 << 30);

  let stop: () => void = () => {};
  const until = new Promise<void>((settle) => {
    stop = () => settle();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stop);

  return {
    address: attached.address,
    until,
    close: async () => {
      clearInterval(held);
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.off(signal, stop);
      stop();
      await attached.close();
    },
  };
}

/**
 * What a watcher is holding, read from another process.
 *
 * The refusals are the point of this function. A reader that cannot reach a
 * watcher has made one of two mistakes — nothing is listening, or something is
 * listening somewhere else — and both look identical from here as a dropped
 * connection. Naming the address it tried, and the command that starts one, is
 * what turns that into something the reader can act on without going to read
 * this file.
 */
export async function readVantage(at: string): Promise<VantageReading> {
  const where = asked(at);

  let response: Response;
  try {
    response = await fetch(where);
  } catch (error) {
    throw new OperatorError(
      `nothing answered at \`${at}\` (${messageOf(error)}). Start a watcher with ` +
        '`variance watch`, then start the suite with the address it prints. A watcher holds the ' +
        'run in memory, so one that has been stopped cannot be asked about the run it held.',
    );
  }

  if (!response.ok) {
    throw new OperatorError(
      `\`${at}\` answered ${String(response.status)} and is not a variance-authority watcher. ` +
        `A watcher answers a reading at \`${VANTAGE_ASK}\`; check the address is the one ` +
        '`variance watch` printed and not another service on the same port.',
    );
  }

  return (await response.json()) as VantageReading;
}

/** The reading endpoint on a watcher's origin, whatever trailing shape the address arrived in. */
function asked(at: string): URL {
  try {
    return new URL(VANTAGE_ASK, at);
  } catch {
    throw new OperatorError(
      `\`${at}\` is not an address. It should be the origin \`variance watch\` printed, like ` +
        '`http://127.0.0.1:54321`.',
    );
  }
}
