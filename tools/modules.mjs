import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every tracked module, by every name Node and TypeScript load one under.
 *
 * Shared because five checks each typed this list by hand and every one typed
 * it short: the `.cts` modules are the ones loaded inside another runner's
 * sandbox, and while the line count left them out, `journal-format.cts` reached
 * 527 lines unread. A rule about source reads this list, so the extensions are
 * named once. It is JavaScript so a runner under `tools/` reads it as a check does.
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Tracked files under the patterns, as `git ls-files` names them. */
export const tracked = (...patterns) =>
  execFileSync('git', ['ls-files', '--', ...patterns], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    // Tracked but removed from the working tree: a deletion not yet committed.
    .filter((file) => file !== '' && existsSync(join(ROOT, file)));

export const MODULES = tracked('*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs');
