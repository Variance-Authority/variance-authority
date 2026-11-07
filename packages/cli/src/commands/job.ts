// compass: variance-authority.reach
/** `variance job`: run a command and record what it touched, which `recordJob` owns. */

import { realpath } from 'node:fs/promises';
import { recordJob } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedJob } from '../job-args.js';
import type { Streams } from './configless.js';
import { topLevel } from './since.js';
import { namedSuite } from './suite-record.js';

/** Run `parsed`'s command under the recorder, answering its exit. */
export async function runJob({ suite, run, completeOn }: ParsedJob, streams: Pick<Streams, 'err'>, cwd = process.cwd()): Promise<number> {
  const top = await topLevel(cwd);
  const root = top === undefined ? undefined : await realpath(top);
  if (root !== undefined) await refuseAnotherSuite(root, suite);
  const exit = await recordJob({ root, cwd, suite, run, completeOn }, (why) => streams.err(`Not recorded: ${why}. The command runs.\n`));
  if (exit === undefined) throw new OperatorError(`\`${run[0]!}\` could not be started: no such command`);
  return exit;
}

/** A job's row replaces the record it lands in, so only a suite declared as a job has one to give. */
async function refuseAnotherSuite(root: string, suite: string): Promise<void> {
  const { declared } = await namedSuite(root, suite);
  if (declared?.kind === 'job') return;
  const is = declared === undefined ? 'is not a declared suite' : `is a suite of kind \`${declared.kind}\``;
  throw new OperatorError(`\`${suite}\` ${is}, and a job would replace its record: declare a suite of kind \`job\` in variance.config.json`);
}
