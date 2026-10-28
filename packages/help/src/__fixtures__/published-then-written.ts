import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readWorkspace } from '../read.js';

/**
 * A workspace whose generation is published, with `keptOf` written into it
 * after: the name a reused generation refuses as not published.
 */

/** The date line of an answer from a generation nothing compared with the checkout. */
export const UNCOMPARED = /Snapshot \d{4}-\d\d-\d\dT[\d:.]+Z, not compared with the checkout: run `variance index` if files changed since\./u;

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** The cache and the checkouts made under it, and how to remove them. */
export function publishing(): { readonly cache: () => string; readonly published: () => Promise<string>; readonly before: () => void; readonly after: () => void } {
  let cache = '';
  let previous: string | undefined;
  const made: string[] = [];
  return {
    cache: () => cache,
    before: () => {
      previous = process.env['VARIANCE_AUTHORITY_CACHE'];
      cache = mkdtempSync(join(tmpdir(), 'va-caught-cache-'));
      process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
      made.push(cache);
    },
    after: () => {
      if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
      else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
    },
    published: async () => {
      // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-caught-')));
      made.push(root);
      execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
      write(root, {
        'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
        'packages/kit/package.json': JSON.stringify({ name: '@acme/kit' }),
        'packages/kit/src/tax.ts': 'export function taxOf(amount: number): number {\n  return amount / 5;\n}\n',
      });
      await readWorkspace(root);
      write(root, { 'packages/kit/src/kept.ts': 'export function keptOf(amount: number): number {\n  return amount;\n}\n' });
      return root;
    },
  };
}
