// compass: variance-authority.reach
/**
 * The GitHub CLI, which already holds the job's token or the reader's login,
 * run for the commands that read a run's artifacts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Runs `gh` with the arguments in the directory, and gives what it printed. */
export type Gh = (args: readonly string[], options: { readonly cwd: string }) => Promise<{ readonly stdout: string }>;

export const gh: Gh = (args, options) => promisify(execFile)('gh', [...args], { ...options, maxBuffer: 64 * 1024 * 1024 });

/** Why `gh` failed, in the operator's words: missing from the PATH, or what it printed. `flag` is the option that needed it. */
export function ghFailed(error: unknown, command: string, flag: string): string {
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOENT') return `${flag} downloads the artifact with the GitHub CLI, \`gh\`, and \`gh\` is not on the PATH. Install it from https://cli.github.com and run \`gh auth login\`.`;
  const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
  return `\`${command}\` failed${stderr === '' ? '.' : `: ${stderr}`}`;
}
