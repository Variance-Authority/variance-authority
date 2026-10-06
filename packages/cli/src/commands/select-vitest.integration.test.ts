import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatSelection, skippableTests } from './select.js';

/**
 * `--format vitest` handed to the vitest this repository installs.
 *
 * The unit tests in `select.test.ts` compare strings. A string vitest does not
 * match is no error anywhere — the narrowed run is the whole suite and stays
 * green — so the only test that can see it is one that asks vitest itself which
 * files it would run.
 */

const VITEST = createRequire(import.meta.url).resolve('vitest/package.json');

/** A project of three test files with this repository's vitest linked in, as an install would. */
function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-select-vitest-')));
  mkdirSync(join(root, 'test'));
  mkdirSync(join(root, 'node_modules'));
  symlinkSync(dirname(VITEST), join(root, 'node_modules', 'vitest'), 'dir');
  writeFileSync(join(root, 'vitest.config.mjs'), 'export default { test: { include: ["test/**/*.test.mjs"] } };\n');
  for (const name of ['alpha', 'beta', 'gamma']) {
    writeFileSync(join(root, 'test', `${name}.test.mjs`), `import { it } from 'vitest';\nit('${name}', () => {});\n`);
  }
  return root;
}

function collected(root: string, args: readonly string[]): string[] {
  const listed = execFileSync(process.execPath, [join(dirname(VITEST), 'vitest.mjs'), 'list', '--filesOnly', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return listed.split('\n').map((line) => line.trim()).filter((line) => line.endsWith('.test.mjs')).sort();
}

describe('a skip list reaches the vitest that is installed', () => {
  it('leaves out of the run exactly the files it skips', () => {
    const root = project();
    const selection = skippableTests({
      at: join(root, 'coverage.bin'),
      commit: 'c0ffee',
      ground: {
        kind: 'read',
        narrowing: {
          whole: ['test/alpha.test.mjs', 'test/beta.test.mjs', 'test/gamma.test.mjs'],
          entered: ['test/beta.test.mjs'],
          because: [],
          stale: [],
          unread: [],
        },
      },
    });
    const args = formatSelection(selection, 'vitest', root).split('\n').filter((line) => line !== '');

    expect(selection.skip).toEqual(['test/alpha.test.mjs', 'test/gamma.test.mjs']);
    expect(collected(root, args)).toEqual(['test/beta.test.mjs']);
  });

  it.todo(
    'leaves them out of a vitest 2 workspace, whose projects each match a pattern against their own directory — ' +
      'needs each project directory, which only the resolved workspace holds, to write the path relative to it',
  );
});
