import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preconditionEntries, rstest } from './__fixtures__/precondition-entries.js';
import { decodeTestCoverage } from './format.js';

// `rstest merge-reports` reads the entries when it merges the blob reports a
// run wrote, and writes the record only once every entry was read.
const { fixture, runs, finished, directory, recordOrNone } = preconditionEntries();

describe('rstest merge-reports', () => {
  const merged = (config: string, entries: readonly string[], env?: NodeJS.ProcessEnv) =>
    finished([rstest, 'merge-reports', '-c', resolve(fixture, config)], entries, env);

  it('refuses an entry it cannot read, and writes no record without it', async () => {
    await finished([...runs['Rstest']!, '--reporter=blob'], []);
    const before = await recordOrNone();

    const { code, output } = await merged('rstest.config.mjs', ['src/value.ts', 'missing.json']);

    expect(output).toContain(`names ${resolve(fixture, 'missing.json')}, which`);
    expect(code).not.toBe(0);
    expect(await recordOrNone()).toEqual(before);
  }, 120_000);

  it('writes what the run declared', async () => {
    await finished([...runs['Rstest']!, '--reporter=blob'], []);

    const { code, output } = await merged('rstest.config.mjs', ['src/value.ts']);

    expect(output).toContain('Merging 1 blob report');
    expect(code).toBe(0);
    const { tests } = decodeTestCoverage(await readFile(resolve(directory(), 'coverage.bin')));
    expect(tests[0]!.preconditions.map(({ name }) => name.slice(name.indexOf('precondition-entries/') + 21))).toEqual([
      'src/value.ts',
      'test/entries.check.ts',
    ]);
  }, 120_000);

  it('refuses an entry of the configuration listing the projects', async () => {
    await finished([rstest, 'run', '-c', resolve(fixture, 'rstest.projects.config.mjs'), '--reporter=blob'], []);

    const { code, output } = await merged('rstest.projects.config.mjs', ['missing.json']);

    expect(output).toContain(`names ${resolve(fixture, 'missing.json')}, which`);
    expect(code).not.toBe(0);
  }, 120_000);

  it('reads no entry of a project none of whose tests it merges', async () => {
    await finished([rstest, 'run', '-c', resolve(fixture, 'rstest.projects.config.mjs'), '--project', 'one', '--reporter=blob'], []);

    const { code, output } = await merged('rstest.projects.config.mjs', [], { FIXTURE_PROJECT_PRECONDITIONS: '["missing.json"]' });

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
  }, 120_000);
});
