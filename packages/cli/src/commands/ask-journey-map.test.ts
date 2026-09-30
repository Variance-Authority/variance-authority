import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_OPERATOR } from '../exit.js';

/** `variance ask journey-map`, through the command a person types: it refuses by naming what is missing. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-journey-map-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-journey-map-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; err: string }> {
  let err = '';
  const code = await main(argv, { out: () => undefined, err: (text) => { err += text; } });
  return { code, err };
}

describe('variance ask journey-map', () => {
  it('asks for the file when none is named', async () => {
    checkout();
    const answered = await run(['ask', 'journey-map']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('--file');
  });

  it('says the checkout has no recording to read when nothing was recorded', async () => {
    checkout();
    const answered = await run(['ask', 'journey-map', '--file', 'src/a.ts', '--query', 'pay']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('holds no suite to read');
  });

  it('refuses a mistyped path as not in the checkout, rather than as a file no test ran, and names the path one typo away', async () => {
    const root = await recorded();

    const answered = await run(['ask', 'journey-map', '--file', 'src/comands/since.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain(
      `\`src/comands/since.ts\` is in neither the recording nor the files git lists under ${root}.\nDid you mean \`src/commands/since.ts\`?`,
    );
    expect(answered.err).not.toContain('No recorded test');
  });

  it('refuses a path under the wrong directory as not in the checkout, and names the recorded files of the same name', async () => {
    const root = await recorded();

    const answered = await run(['ask', 'journey-map', '--file', 'src/test-selection/since.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain(
      `\`src/test-selection/since.ts\` is in neither the recording nor the files git lists under ${root}.\n` +
        'The recording holds `since.ts` at `src/commands/since.ts`.',
    );
    expect(answered.err).not.toContain('Did you mean');
  });
});

/** A recording in which `test/since.test.ts` entered `src/commands/since.ts`, and a checkout that holds neither file. */
async function recorded(): Promise<string> {
  const root = checkout();
  const at = testCoverageFile(root);
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{ file: 'test/since.test.ts', complete: true, preconditions: [] }],
    modules: [{
      file: 'src/commands/since.ts',
      sourceDigest: 'digest:since',
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: 'block:since', name: '', path: 'entry', source: true,
        startLine: 1, endLine: 5, testFiles: ['test/since.test.ts'],
      }],
    }],
  });
  writeFileSync(`${at}.cases.bin`, encodeExecutionIndex({
    tests: [{ id: 's1', file: 'test/since.test.ts', name: 'reads' }],
    modules: [{
      file: 'src/commands/since.ts',
      blocks: [{ kind: 'module', name: '', path: 'entry', startLine: 1, endLine: 5, source: true, crossings: [{ test: 0, distance: 0 }] }],
    }],
  }));
  return root;
}
