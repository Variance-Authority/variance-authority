// compass: variance-authority.reach
/**
 * `variance janus`: files rolled back to their text at a ref, under a command
 * run on the code as it is, in place.
 *
 * Each named file is served at its base text to every process the command
 * starts; every other file is the checkout's. It rolls back a change made to a
 * file both sides hold, so the tests as they stood run on the code after it.
 * It neither adds a file nor hides one: a file the checkout or the base lacks
 * is refused. Nothing is written to the checkout, so a killed run leaves it as
 * it was, and no second tree is made.
 *
 * The serving happens under the runner, so a reader below it escapes quietly.
 * Each process notes the served files it read, and a run that never read one
 * fails and names it: a green that read the head's text is not the base's.
 */

import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { serveBase } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedJanus } from '../janus-args.js';
import type { Streams } from './configless.js';
import { diffPoint } from './since.js';

/** Run `parsed`'s command with its files rolled back, answering its exit, or 1 when a served file went unread. */
export async function runJanus({ since, files, run }: ParsedJanus, streams: Pick<Streams, 'err'>, cwd = process.cwd()): Promise<number> {
  const served = await baseTexts(since, files, cwd);
  const ran = await serveBase(served, run, cwd);
  if (ran === undefined) throw new OperatorError(`\`${run[0]}\` could not be started: no such command`);
  const { exit, unread } = ran;
  if (unread.length === 0) return exit;
  streams.err(
    `Not the base's run: no process read ${unread.length === 1 ? 'this file' : 'these files'} as of \`${since}\`, so what ran is not shown to be the base's:\n` +
      unread.map((file) => `  ${relative(cwd, file)}\n`).join('') +
      'Run the tests these files hold, or a runner that reads them through Node.\n',
  );
  return exit === 0 ? 1 : exit;
}

/** Each file by absolute path, with its text at the merge base with `since`; refused when either side lacks it. */
async function baseTexts(since: string, files: readonly string[], cwd: string): Promise<Record<string, string>> {
  const point = await diffPoint(since, [], cwd);
  if (point === undefined) throw new OperatorError(`\`--since ${since}\` could not be read at its merge base`);
  const texts: Record<string, string> = {};
  for (const file of files) {
    const path = resolve(cwd, file);
    const held = await stat(path).then((entry) => entry.isFile(), () => false);
    if (!held) throw new OperatorError(`\`${file}\` is not a file in the checkout: janus rolls back changes to files that exist`);
    const base = await point.at(relative(point.repository, path));
    if (base === undefined) throw new OperatorError(`\`${file}\` did not exist at \`${since}\`: janus rolls back changes to files that exist on both sides`);
    texts[path] = base;
  }
  return texts;
}
