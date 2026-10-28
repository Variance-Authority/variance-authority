import { readFile, writeFile } from 'node:fs/promises';
import type { RunReport } from '@variance-authority/report';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';

/**
 * Where the subject of the previous answer is kept, beside the report it is about.
 *
 * In the report's directory rather than a cache of this tool's own, because it is
 * a fact about *that artifact* and it should disappear with it. It is derived and
 * disposable: deleting it costs the next `diff` its comparison and nothing else.
 */
export const ASKED = 'asked.json';

/**
 * The subject of the previous answer, or nothing.
 *
 * Unreadable is the same as absent here, and only here. It is a derived file in
 * the run's own output directory, not evidence: the state it holds was written
 * by this command and can be reproduced by asking again, so refusing to answer
 * because a cache is malformed would withhold the report over the one file in
 * this system that nobody has to keep.
 */
export async function recorded(path: string): Promise<RunReport | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RunReport;
  } catch {
    return undefined;
  }
}

/**
 * Record what this answer was read from, or say that it could not be.
 *
 * Loud rather than best-effort. A silent failure here does not spoil this
 * answer; it spoils the *next* `diff`, which would then report that nothing has
 * changed since a run it never saw — and that answer arrives with nothing
 * attached to say it was built on a write that did not happen.
 */
export async function record(path: string, report: RunReport): Promise<void> {
  try {
    await writeFile(path, `${JSON.stringify(report)}\n`, 'utf8');
  } catch (error) {
    throw new OperatorError(
      `the answer could not be recorded to \`${path}\`: ${messageOf(error)}. Each answer ` +
        'replaces the state `ask diff` compares against, so leaving it unwritten would let a ' +
        'later diff answer from a run nobody read.',
    );
  }
}
