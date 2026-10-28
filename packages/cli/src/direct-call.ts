import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The same command, called without the package manager that launched it.
 *
 * A package manager that runs an installed binary starts itself first, and on a
 * large workspace that start — reading the manifest, checking the install —
 * costs more than the answer. An agent asks question after question, so the
 * cost is paid on every one. The installed binary answers the same command
 * without it.
 *
 * This is said, not done: how to call the program stays the caller's choice,
 * and the line is one thing it can do about the wait. So it is said only when
 * the faster call exists and is this very program:
 *
 * - a package manager launched it, as `npm_config_user_agent` says — every one
 *   of them sets it, and a direct call inherits it only from a script;
 * - not from a package script, which sets `npm_lifecycle_event` to the name
 *   of a script the nearest `package.json` declares: there the script's author
 *   chose the call. A launch leaves the event unset, or sets it to a name no
 *   script declares, and which name differs from one package manager to the
 *   next, so none is read;
 * - it runs in the directory the command was typed in, which a package manager
 *   records as `INIT_CWD`. One that runs the binary elsewhere would have the
 *   same arguments name other files when typed where the caller stands;
 * - the nearest `node_modules/.bin/variance` above the working directory is this
 *   file. Under Plug'n'Play there is no such directory. Some package managers,
 *   and every one on Windows, write a wrapper script there, which is not this
 *   file. A binary that is another install's would answer in that version's way.
 *
 * The binary is named by its full path, so the line holds no directory change.
 */

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
  const launcher = env['npm_config_user_agent'];
  if (launcher === undefined || launcher === '') return '';
  const event = env['npm_lifecycle_event'];
  if (event !== undefined && declaresScript(cwd, event)) return '';
  const typedIn = env['INIT_CWD'];
  if (typedIn !== undefined && typedIn !== '' && resolve(typedIn) !== resolve(cwd)) return '';
  const binary = nearest(cwd, join('node_modules', '.bin', 'variance'));
  if (binary === undefined || !sameFile(binary, self)) return '';
  const command = [binary, ...argv].map(quoted).join(' ');
  return `\nvariance: the same command answers faster: ${command}\n`;
}

/** The first `path` from `cwd` upward, as Node resolves a package and a package manager finds its manifest. */
function nearest(cwd: string, path: string): string | undefined {
  for (let at = cwd; ; at = dirname(at)) {
    const candidate = join(at, path);
    if (existsSync(candidate)) return candidate;
    if (dirname(at) === at) return undefined;
  }
}

/** Whether the nearest `package.json` declares a script named `name`. An unreadable one declares nothing. */
function declaresScript(cwd: string, name: string): boolean {
  const manifest = nearest(cwd, 'package.json');
  if (manifest === undefined) return false;
  try {
    const scripts: unknown = (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: unknown }).scripts;
    return typeof scripts === 'object' && scripts !== null && Object.hasOwn(scripts, name);
  } catch {
    return false;
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
