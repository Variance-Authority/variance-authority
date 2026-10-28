// compass: variance-authority/runtime/attention
/**
 * The diff a base is compared through.
 *
 * A base's regions are numbered by the lines they stood on at the commit it was
 * recorded at. The `-U0` diff from that commit to the tree is what says which
 * region now stands where each stood then, so it is the only pairing: with no
 * commit, or a commit this clone does not have, nothing is compared and the
 * command is refused with what to fetch.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { hunksByFile, standsAt, type Hunk, type Stand } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { RecordRuns } from './record-runs.js';
import { diffSince, gitIn, topLevel } from './since.js';

const OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/**
 * The sentence {@link diffFromBase} refuses a base with that names no commit,
 * for a caller that knows so before it asks and leaves the base uncompared.
 */
export function unnamedCommit(base: { readonly name: string; readonly unnamed?: string }): string {
  return (
    `${base.name} names no commit it was recorded at, so it is not compared: its regions are paired with the current ones ` +
    `only through the diff from that commit.${base.unnamed === undefined ? '' : ` ${base.unnamed}`}`
  );
}

/**
 * The diff by file from `at`, the commit the base `base` names was recorded at,
 * to the tree at `root`, with that commit. `base` opens each refusal, as a
 * sentence's subject; `unnamed`, when given, says why a base of that kind can
 * name no commit.
 */
export async function diffFromBase(
  at: string | undefined,
  root: string,
  base: { readonly name: string; readonly unnamed?: string },
): Promise<{ readonly commit: string; readonly diff: ReadonlyMap<string, readonly Hunk[]> }> {
  const refuse = (why: string): never => {
    throw new OperatorError(`${base.name} ${why}`, { kind: 'undiffed' });
  };
  if (at === undefined) throw new OperatorError(unnamedCommit(base), { kind: 'undiffed' });
  if (!OBJECT_NAME.test(at)) return refuse(`was recorded at \`${at}\`, which is not a commit's object name, so it is not compared.`);
  const repository = await topLevel(root);
  if (repository === undefined) return refuse(`was recorded at ${at}, and \`${root}\` is not in a git checkout to diff from it.`);
  try {
    await promisify(execFile)('git', ['cat-file', '-e', `${at}^{commit}`], { cwd: repository });
  } catch {
    return refuse(
      `was recorded at ${at}, which this clone does not have, so it is not compared. ` +
        `Fetch it with \`git fetch origin ${at}\`, or check out every commit: ` +
        '`fetch-depth: 0` with `filter: tree:0` on `actions/checkout`.',
    );
  }
  const diff = await diffSince(at, [], at, { cwd: root, unified: 0 });
  if (diff === undefined) return refuse(`was recorded at ${at}, and git could not read the diff from it to the working tree, so it is not compared.`);
  return { commit: at, diff: hunksByFile(diff) };
}

/**
 * Where `since` and `HEAD` part, and the files the base's branch changed
 * between the base's commit and there, named the way the run names files.
 * Refused with git's answer when git cannot say: without it, the base
 * branch's own motion would be read as this change's.
 */
export async function movedOnBase(
  at: string,
  since: string,
  root: string,
): Promise<{ readonly mergeBase: string; readonly files: readonly string[] }> {
  const run = promisify(execFile);
  try {
    const top = (await run('git', ['rev-parse', '--show-toplevel'], { cwd: root })).stdout.trim();
    const mergeBase = (await run('git', ['merge-base', since, 'HEAD'], { cwd: top })).stdout.trim();
    if (at === mergeBase) return { mergeBase, files: [] };
    const { stdout } = await run('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', at, mergeBase], {
      cwd: top,
      maxBuffer: 32 * 1024 * 1024,
    });
    const files = stdout.split('\0').filter((file) => file !== '').map((file) => relative(root, join(top, file)));
    return { mergeBase, files: files.sort() };
  } catch (error) {
    const said = (error as { stderr?: unknown }).stderr;
    throw new OperatorError(
      `What the branch of \`${since}\` changed after ${at} could not be read, so the base is not compared: ` +
        `${typeof said === 'string' && said.trim() !== '' ? said.trim() : error instanceof Error ? error.message : String(error)}. ` +
        'A shallow clone has only the tip: check out every commit with `fetch-depth: 0` and `filter: tree:0` on `actions/checkout`.',
      { kind: 'undiffed' },
    );
  }
}

/**
 * The stands of the record `read` read: the test files that did not run at its
 * commit, and the files changed since each last ran, so a case the record
 * carried over an edit is not read as gone. A runs record that is there and
 * cannot be read is refused, naming it: read as absent, it would place every
 * test at the record's commit, and a case no test ran would be called no
 * longer run.
 */
export function carriedOver(read: RecordRuns, root: string): { readonly stands?: readonly Stand[] } {
  const { record, repository } = read;
  if (repository === undefined) {
    throw new OperatorError(`\`${root}\` is not in a git checkout, so where each test in ${record} last ran is not read and nothing is compared.`, {
      kind: 'undiffed',
    });
  }
  if (read.unread !== undefined) {
    throw new OperatorError(
      `${read.unread.message}. It says where each test in the record last ran, and ` +
        'a comparison that read it as absent would call a case no test ran no longer run.',
      { cause: read.unread },
    );
  }
  const reading = standsAt(record, read.runs, gitIn(repository), (test) => existsSync(join(repository, test)));
  return reading === undefined ? {} : { stands: reading.stands };
}
