import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './markdown.js';

/**
 * Every tracked module, by every name Node and TypeScript load one under.
 *
 * Shared because four checks each typed this list by hand and three typed it
 * short: the `.cts` modules are the ones loaded inside another runner's
 * sandbox, and while the line count left them out, `journal-format.cts` reached
 * 527 lines unread. A rule about source reads this list, so the extensions are
 * named once.
 */
export const MODULES: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .trim()
  .split('\n')
  // Tracked but removed from the working tree: a deletion not yet committed.
  .filter((file) => existsSync(join(ROOT, file)));
