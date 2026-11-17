import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preconditionEntries, rstest, vite, vitest } from './__fixtures__/precondition-entries.js';

// A command that loads the configuration and runs no test is not a run, nor is
// one with no test file: each exits as it would without the seam.
const { fixture, runs, refusedAlike, finished, directory, ran } = preconditionEntries();

const quiet: Readonly<Record<string, readonly string[]>> = {
  'Jest --listTests': [...runs['Jest']!, '--listTests'],
  'Jest --showConfig': [...runs['Jest']!, '--showConfig'],
  'Jest with no test to run': [...runs['Jest']!, '--passWithNoTests', '--testPathPatterns', 'no-such-test'],
  'Vitest with no test to run': [...runs['Vitest']!, '--passWithNoTests', 'no-such-test'],
  'Rstest with no test to run': [...runs['Rstest']!, '--passWithNoTests', 'no-such-test'],
  'Rstest with projects and no test to run': [...refusedAlike['Rstest with projects']!, '--passWithNoTests', 'no-such-test'],
  'vitest list': [vitest, 'list', '--config', resolve(fixture, 'vitest.config.ts')],
  'vitest list that loads each test file': [vitest, 'list', '--no-staticParse', '--config', resolve(fixture, 'vitest.config.ts')],
  'rstest list': [rstest, 'list', '-c', resolve(fixture, 'rstest.config.mjs')],
};

describe('a command that loads the configuration and runs no test', () => {
  it.each(Object.keys(quiet))('%s exits as it would without the seam', async (name) => {
    const { code, output } = await finished(quiet[name]!, ['src/**/*.ts']);

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(false);
  }, 120_000);

  it('vite build of the shared configuration exits as it would without the seam', async () => {
    const { code, output } = await finished(
      [vite, 'build', '--config', resolve(fixture, 'vitest.config.ts'), '--ssr', 'src/value.ts', '--outDir', resolve(directory(), 'built')],
      ['src/**/*.ts'],
    );

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
  }, 120_000);
});
