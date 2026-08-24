import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { selectTestFiles } from './index.js';
import { withTestSelection } from './vitest.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Vitest integration', () => {
  it('adds one product plugin, setup file, and reporter to an ordinary configuration', () => {
    const configured = withTestSelection({}, { coverageFile: '/tmp/coverage.bin' });

    expect(configured.plugins).toHaveLength(1);
    expect(configured.test?.setupFiles).toHaveLength(1);
    expect(configured.test?.reporters).toHaveLength(2);
  });

  it('records external tests and selects only the test file that covered a changed path', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    for (const testFile of ['test/alpha.case.ts', 'test/beta.case.ts']) {
      await execute(
        process.execPath,
        [vitest, 'run', testFile, '--config', resolve(fixture, 'vitest.config.ts')],
        {
          cwd: fixture,
          env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile },
        },
      );
    }

    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    const line = source.slice(0, source.indexOf("return 'A'")).split('\n').length;
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -${line},1 +${line},1 @@
-    return 'A';
+    return 'Alpha';`;
    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual(['test/alpha.case.ts']);
  }, 20_000);
});
