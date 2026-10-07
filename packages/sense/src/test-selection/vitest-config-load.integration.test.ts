import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');

/**
 * Every module a fresh Node loads to import the seam, as the published entry a
 * Vitest config imports. A config is loaded before every run, a one-file run
 * included, so what it loads is paid for on each of them.
 */
async function loadedByTheSeam(): Promise<readonly string[]> {
  const probe = [
    "import { registerHooks } from 'node:module';",
    'const loaded = [];',
    'registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context); } });',
    "await import('@variance-authority/sense/vitest');",
    'process.stdout.write(JSON.stringify(loaded));',
  ].join('\n');
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', probe], { cwd: repository });

  return JSON.parse(stdout) as string[];
}

// Nothing the seam runs uses the parser or the resolver: it transforms with
// the native addon. They came in with the package's index, which the fold
// imported for two functions of one module, and with them every reader the
// index exports.
it('importing the Vitest seam loads neither the parser, the resolver, nor the whole of the package', async () => {
  const loaded = await loadedByTheSeam();

  expect(loaded.filter((url) => /\/(oxc-parser|oxc-resolver|@oxc-parser|@oxc-resolver)\//.test(url))).toEqual([]);
  expect(loaded.filter((url) => url.endsWith('/sense/dist/test-selection/index.js'))).toEqual([]);
});
