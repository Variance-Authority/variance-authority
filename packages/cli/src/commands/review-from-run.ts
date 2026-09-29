// compass: variance-authority/runtime/attention
/**
 * The review a CI run kept, read back on a laptop.
 *
 * A pull request's comment is `review.md`, and the workflow uploads
 * `review.json` beside it. That JSON is the whole answer: every region, every
 * test file's reach. The comment prints a part of it. A reader who wants the
 * rest asks for the run, and the GitHub CLI, which already holds their login
 * and knows the repository of the checkout, downloads the artifact. Nothing is
 * recomputed: the answer is the one the run gave, printed in the format asked
 * for.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { OperatorError } from '../exit.js';
import type { Review } from './review.js';

/** The artifact `.github/workflows/check.yml` uploads the review under. */
export const REVIEW_ARTIFACT = 'variance-review';

export interface RunRequest {
  /** A run id, or the URL of a run or of one of its jobs. */
  readonly run: string;
  readonly artifact: string;
  readonly root: string;
}

/** A run named by id or by its URL, and the repository the URL names. */
export function runOf(text: string): { readonly id: string; readonly repo?: string } {
  if (/^\d+$/u.test(text)) return { id: text };
  const url = /github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/u.exec(text);
  if (url !== null) return { id: url[2]!, repo: url[1]! };
  throw new OperatorError(`--from-run takes a run id or the URL of a run, not \`${text}\``);
}

type Exec = (file: string, args: readonly string[], options: { readonly cwd: string }) => Promise<unknown>;

const run: Exec = (file, args, options) => promisify(execFile)(file, [...args], options);

/** Downloads the run's review artifact with `gh` and reads the review it holds. */
export async function reviewFromRun(request: RunRequest, exec: Exec = run): Promise<Review> {
  const { id, repo } = runOf(request.run);
  const into = await mkdtemp(join(tmpdir(), 'variance-review-'));
  try {
    const args = ['run', 'download', id, '--name', request.artifact, '--dir', into, ...(repo === undefined ? [] : ['--repo', repo])];
    try {
      await exec('gh', args, { cwd: request.root });
    } catch (error) {
      throw new OperatorError(downloadFailed(error, `gh ${args.slice(0, 5).join(' ')}`));
    }
    let text: string;
    try {
      text = await readFile(join(into, 'review.json'), 'utf8');
    } catch {
      throw new OperatorError(`run ${id}'s artifact \`${request.artifact}\` holds no review.json, so there is no review to print.`);
    }
    return JSON.parse(text) as Review;
  } finally {
    await rm(into, { recursive: true, force: true });
  }
}

function downloadFailed(error: unknown, command: string): string {
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOENT') return '--from-run downloads the artifact with the GitHub CLI, `gh`, and `gh` is not on the PATH. Install it from https://cli.github.com and run `gh auth login`.';
  const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
  return `\`${command}\` failed${stderr === '' ? '.' : `: ${stderr}`}`;
}
