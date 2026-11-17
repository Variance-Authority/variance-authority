import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preconditionEntries, repository } from './__fixtures__/precondition-entries.js';

/**
 * An entry in `preconditions` is refused when the runner announces a test run,
 * before any test starts, so each case here runs a real runner. What a project
 * declares, a run that merges reports and a command that runs no test are each
 * a file of their own beside this one.
 */

const { fixture, runs, refusedAlike, finished, directory, ran } = preconditionEntries();

describe.each(Object.keys(runs))('a %s run', (runner) => {
  const command = runs[runner]!;

  it('refuses a glob with no test run, and names the path it resolved to', async () => {
    const { code, output } = await finished(command, ['src/**/*.ts']);

    expect(existsSync(ran())).toBe(false);
    expect(code).not.toBe(0);
    expect(output).toContain(`names ${resolve(fixture, 'src/**/*.ts')}, which`);
    expect(output).toContain('Each entry is the path of one file');
    expect(output).not.toContain('could not be read');
  }, 120_000);

  it('refuses a directory with no test run', async () => {
    const { code, output } = await finished(command, ['src']);

    expect(existsSync(ran())).toBe(false);
    expect(code).not.toBe(0);
    expect(output).toContain(`names ${resolve(fixture, 'src')}, which`);
  }, 120_000);

  it('refuses a file a test would write, and says that is not a precondition', async () => {
    const written = resolve(directory(), 'generated.json');

    const { code, output } = await finished(command, [written], { FIXTURE_TEST_WRITES: written });

    expect(existsSync(ran())).toBe(false);
    expect(code).not.toBe(0);
    expect(output).toContain('a file a test writes during the run is not a precondition');
  }, 120_000);
});

describe('a file global setup writes', () => {
  it('passes under Jest, which announces the run after that setup', async () => {
    const written = resolve(directory(), 'generated.json');

    const { code, output } = await finished(runs['Jest']!, [written], { FIXTURE_SETUP_WRITES: written });

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(true);
  }, 120_000);

  it.each(['Vitest', 'Rstest'])('is refused under %s, which announces the run before it', async (runner) => {
    const written = resolve(directory(), 'generated.json');

    const { code, output } = await finished(runs[runner]!, [written], { FIXTURE_SETUP_WRITES: written });

    expect(output).toContain('cannot be read as a file');
    expect(code).not.toBe(0);
    expect(existsSync(ran())).toBe(false);
  }, 120_000);
});

it('a refused Rstest run leaves no seam module behind', async () => {
  await finished(runs['Rstest']!, ['src/**/*.ts']);

  expect(existsSync(resolve(fixture, '.variance-authority'))).toBe(false);
}, 120_000);

it.each(['Jest', 'Vitest'])('a refused %s run that cut a file leaves no cut behind', async (runner) => {
  const { code, output } = await finished(runs[runner]!, ['src/**/*.ts'], {
    FIXTURE_CUT: relative(repository, resolve(fixture, 'test/entries.check.ts')),
  });

  expect(output).toContain('cannot be read as a file');
  expect(code).not.toBe(0);
  expect((await readdir(directory())).filter((name) => name.includes('cut'))).toEqual([]);
}, 120_000);

describe('a run the entry is refused from', () => {
  it.each(Object.keys(refusedAlike))('%s', async (name) => {
    const { code, output } = await finished(refusedAlike[name]!, ['src/**/*.ts']);

    expect(existsSync(ran())).toBe(false);
    expect(code).not.toBe(0);
    expect(output).toContain(`names ${resolve(fixture, 'src/**/*.ts')}, which`);
    expect(output).not.toContain('could not be read');
  }, 120_000);
});
