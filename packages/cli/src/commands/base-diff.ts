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
import { promisify } from 'node:util';
import { hunksByFile, type Hunk } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { diffSince, topLevel } from './since.js';

const OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

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
  if (at === undefined) {
    return refuse(
      'names no commit it was recorded at, so it is not compared: its regions are paired with the current ones ' +
        `only through the diff from that commit.${base.unnamed === undefined ? '' : ` ${base.unnamed}`}`,
    );
  }
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
