// compass: variance-authority.reach
/** `variance job`: run a command and record what it touched, which `recordJob` owns. */

import { realpath } from 'node:fs/promises';
import { recordJob } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedJob } from '../job-args.js';
import type { Streams } from './configless.js';
import { topLevel } from './since.js';

/** Run `parsed`'s command under the recorder, answering its exit. */
export async function runJob({ suite, run, completeOn }: ParsedJob, streams: Pick<Streams, 'err'>, cwd = process.cwd()): Promise<number> {
  const top = await topLevel(cwd);
  const root = top === undefined ? undefined : await realpath(top);
  const exit = await recordJob({ root, cwd, suite, run, completeOn }, (why) => streams.err(`Not recorded: ${why}. The command runs.\n`));
  if (exit === undefined) throw new OperatorError(`\`${run[0]!}\` could not be started: no such command`);
  return exit;
}
