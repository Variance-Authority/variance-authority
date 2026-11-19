// compass: variance-authority.reach
/**
 * `variance janus`: the tests as they stood at a ref, run on the code as it is,
 * in place.
 *
 * Every test-side file the diff since the ref changed is served at its base
 * text to every process the command starts: a test the change edited reads its
 * old text, one it deleted is back, and one it added is gone. The source is the
 * checkout's. Nothing is written to the checkout, so a killed run leaves it as
 * it was, and no second tree is made.
 *
 * The serving happens under the runner, so a reader below it escapes quietly.
 * Each process notes the served files it read, and a run that never read one
 * fails and names it: a green that read the head's text is not the base's.
 */

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { isTestPath } from '@variance-authority/sense';
import { serveBase } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedJanus } from '../janus-args.js';
import type { Streams } from './configless.js';
import { changedSince, diffPoint } from './since.js';

/** Run `parsed`'s command with the base's tests served, answering its exit, or 1 when a served file went unread. */
export async function runJanus({ since, run }: ParsedJanus, streams: Pick<Streams, 'err'>, cwd = process.cwd()): Promise<number> {
  const files = await baseTests(since, cwd);
  if (Object.keys(files).length === 0) streams.err(`Nothing on the test side changed since \`${since}\`: the command runs on the tests as they are.\n`);
  const ran = await serveBase(files, run, cwd);
  if (ran === undefined) throw new OperatorError(`\`${run[0]}\` could not be started: no such command`);
  const { exit, unread } = ran;
  if (unread.length === 0) return exit;
  streams.err(
    `Not the base's run: no process read ${unread.length === 1 ? 'this test' : 'these tests'} as of \`${since}\`, so what ran is not shown to be the base's:\n` +
      unread.map((file) => `  ${relative(cwd, file)}\n`).join('') +
      'Run only the tests the diff changed, or a runner that reads them through Node.\n',
  );
  return exit === 0 ? 1 : exit;
}

/** Each test-side file the diff since `since` changed, by absolute path: its text at the base, or `null` where the base had none. */
async function baseTests(since: string, cwd: string): Promise<Record<string, string | null>> {
  const point = await diffPoint(since, [], cwd);
  if (point === undefined) throw new OperatorError(`\`--since ${since}\` could not be read at its merge base`);
  const changed = (await changedSince(since, [], cwd)).filter(isTestPath);
  const files: Record<string, string | null> = {};
  await Promise.all(
    changed.map(async (file) => {
      const path = resolve(cwd, file);
      const base = (await point.at(relative(point.repository, path))) ?? null;
      const head = await readFile(path, 'utf8').catch(() => null);
      if (base !== head) files[path] = base;
    }),
  );
  return files;
}
