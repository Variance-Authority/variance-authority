import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** The shims a process with this pid wrote into the fixture, and left there. */
function shimsOf(pid: number): string[] {
  try {
    return readdirSync(resolve(fixture, '.variance-authority')).filter((name) =>
      new RegExp(`^test-selection-[a-z-]+-${pid}-[0-9a-f-]+\\.mjs$`).test(name),
    );
  } catch {
    return [];
  }
}

// Other files here run Vitest over the same fixture at the same time, so what
// is asked is whether this run's shims are gone, by the pid that names them.
it('a Vitest run that fails before any file runs leaves no shim behind', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-fails-'));
  temporary.push(directory);
  const tsconfig = resolve(directory, 'tsconfig.json');
  await writeFile(tsconfig, '{}\n', 'utf8');

  const { code, pid, output } = await new Promise<{ code: number | null; pid: number; output: string }>((settle) => {
    let output = '';
    const child = execFile(
      process.execPath,
      [vitest, 'run', '--config', resolve(fixture, 'vitest.typecheck.config.ts')],
      {
        cwd: fixture,
        env: {
          ...process.env,
          VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
          VARIANCE_AUTHORITY_CACHE: directory,
          CUT_TSCONFIG: tsconfig,
        },
      },
      (_error, stdout, stderr) => {
        output = `${stdout}${stderr}`;
      },
    );
    child.on('close', (exit) => settle({ code: exit, pid: child.pid!, output }));
  });

  // The run did fail, and for the reason the configuration set up.
  expect(code, output).not.toBe(0);
  expect(output).toContain('variance-authority-no-such-checker');
  expect(shimsOf(pid)).toEqual([]);
}, 30_000);
