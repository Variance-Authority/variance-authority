import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { said } from './here.js';

/**
 * The same command, called without the package manager that launched it.
 *
 * `yarn variance`, `pnpm exec variance` and `npm exec variance` each start the
 * package manager before this program, and on a large workspace that start —
 * reading the manifest, checking the install — costs more than the answer. An
 * agent asks question after question, so the cost is paid on every one. The
 * installed binary answers the same command without it.
 *
 * This is said, not done: how to call the program stays the caller's choice,
 * and the line is one thing it can do about the wait. So it is said only when
 * the faster call exists and is this very program:
 *
 * - a package manager launched it, as `npm_config_user_agent` says — every one
 *   of them sets it, and a direct call inherits it only from a script;
 * - not from a package script, which sets `npm_lifecycle_event` to the script's
 *   name: there the script's author chose the call. `npm exec` and `bunx` set it
 *   too, to `npx` and `bunx`, and are launches like any other;
 * - the nearest `node_modules/.bin/variance` above the working directory is this
 *   file. Under Plug'n'Play there is no such directory, and a binary that is
 *   another install's would answer another version's way.
 */

/** The `npm_lifecycle_event` of a package manager's exec, which is a launch and not a script. */
const EXEC_EVENTS = new Set(['bunx', 'npx']);

/**
 * The line naming the direct call, or nothing when there is none to name.
 *
 * `self` is this program's file; `env` and `cwd` are the process's, passed so
 * the decision reads only what it is given.
 */
export function directCallLine(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  self: string,
): string {
  const launcher = env['npm_config_user_agent']?.split('/')[0];
  if (launcher === undefined || launcher === '') return '';
  const event = env['npm_lifecycle_event'];
  if (event !== undefined && !EXEC_EVENTS.has(event)) return '';
  const binary = nearestBinary(cwd);
  if (binary === undefined || !sameFile(binary, self)) return '';
  const command = [said(binary, cwd), ...argv.map(quoted)].join(' ');
  return `\nThe same command answers faster without ${launcher}: ${command}\n`;
}

/** The first `node_modules/.bin/variance` from `cwd` upward, as Node resolves a package. */
function nearestBinary(cwd: string): string | undefined {
  for (let at = cwd; ; at = dirname(at)) {
    const binary = join(at, 'node_modules', '.bin', 'variance');
    if (existsSync(binary)) return binary;
    if (dirname(at) === at) return undefined;
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** An argument as a POSIX shell reads it back: bare when it is safe, single-quoted otherwise. */
function quoted(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}
