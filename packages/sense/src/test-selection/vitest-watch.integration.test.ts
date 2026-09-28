import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const ext = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// A child process, because a Vitest started inside this one shares its
// globals. It runs one file, reruns another the way a watcher does on a save,
// and reports the shims this process wrote before and after it closes — to a
// file, since Vitest's banner is on stdout whatever the reporters.
const driver = (vitest: string, report: string): string => `
import { readdirSync, writeFileSync } from 'node:fs';
import { startVitest } from ${JSON.stringify(vitest)};
const shims = () => {
  try { return readdirSync(${JSON.stringify(resolve(fixture, '.variance-authority'))}).filter((name) => name.includes('-' + process.pid + '-')); }
  catch { return []; }
};
const root = ${JSON.stringify(fixture)};
const runner = await startVitest('test', ['test/alpha.case.ts'], { watch: true, root, config: root + '/vitest.config.ts' });
const between = shims();
await runner.rerunFiles([root + '/test/beta.case.ts']);
const rerun = shims();
await runner.close();
writeFileSync(${JSON.stringify(report)}, JSON.stringify({ between, rerun, closed: shims() }));
process.exit(0);
`;

it('records every rerun of a watching Vitest, and leaves no run directory or shim once it closes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-watch-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  const script = resolve(directory, 'drive.mjs');
  const report = resolve(directory, 'shims.json');
  const vitest = pathToFileURL(resolve(repository, 'node_modules/vitest/dist/node.js')).href;
  await writeFile(script, driver(vitest, report), 'utf8');

  await execute(process.execPath, [script], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  const shims = JSON.parse(await readFile(report, 'utf8')) as { between: string[]; rerun: string[]; closed: string[] };

  const coverage = decodeTestCoverage(await readFile(coverageFile));
  expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
    // A case the file's own source skips is an outcome, so alpha is whole too.
    [ext('test/alpha.case.ts'), true],
    [ext('test/beta.case.ts'), true],
  ]);
  expect((await readdir(directory)).filter((name) => name.startsWith('.run-'))).toEqual([]);
  // The rerun's workers load the shims the first run's workers did.
  expect(shims.between).toHaveLength(2);
  expect(shims.rerun).toEqual(shims.between);
  expect(shims.closed).toEqual([]);
});
