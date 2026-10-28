import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * `variance select` over a changed module the record holds no row for, read
 * through the test files that import it: a test runs when it reads one of the
 * module's exports in a case, or as it loads.
 */
describe('a changed module the record did not measure', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-unmeasured-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs a test that converts an export at top level, where the new value can throw as the file loads', async () => {
    // `1n * 2` throws a TypeError, so the conversion is where the change is
    // observed, though nothing reads `doubled` afterwards.
    const root = await recorded({
      'test/alpha.test.ts': `${IMPORTS}const doubled = feature * 2;\nit('runs', () => expect(1).toBe(1));\n`,
    });

    write(root, 'src/feature.ts', 'export const feature = 1n;\n');
    const said = await selectOutput({ cwd: root, format: 'plain' });

    // The plain format lists what is skipped.
    expect(said.out).toBe('test/beta.test.ts\n');
    expect(said.err).toContain('skipping 1 of 2 test files recorded whole');
  });

  it('skips a test that only copies an export into a binding nothing reads', async () => {
    const root = await recorded({
      'test/alpha.test.ts': `${IMPORTS}const copied = feature;\nit('runs', () => expect(1).toBe(1));\n`,
    });

    write(root, 'src/feature.ts', 'export const feature = 1n;\n');
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\n');
    expect(said.err).toContain('skipping 2 of 2 test files recorded whole');
  });
});

const IMPORTS = "import { expect, it } from 'vitest';\nimport { feature } from '../src/feature';\n";
const PAD = ['export function pad(text: string): string {', "  return text.padStart(4, ' ');", '}', ''].join('\n');

/** A checkout holding `files`, `src/feature.ts` and `src/pad.ts`, its index built, and a record at its head. */
async function recorded(files: Readonly<Record<string, string>>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-select-unmeasured-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const all: Record<string, string> = {
    'src/feature.ts': 'export const feature = 1;\n',
    'src/pad.ts': PAD,
    'test/beta.test.ts': "import { expect, it } from 'vitest';\nimport { pad } from '../src/pad';\nit('pads', () => expect(pad('x')).toBe('   x'));\n",
    'package.json': JSON.stringify({ name: 'fixture' }),
    ...files,
  };
  for (const [file, text] of Object.entries(all)) write(root, file, text);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  await writeTestCoverage(testCoverageFile(root), snapshot(git(['rev-parse', 'HEAD'])));
  process.chdir(root);
  await indexOutput({ cwd: root });
  return root;
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** `src/pad.ts`, entered by beta; `src/feature.ts` has no row, though alpha imports it. */
function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/alpha.test.ts', complete: true, preconditions: [] },
      { file: 'test/beta.test.ts', complete: true, preconditions: [] },
    ],
    modules: [
      {
        file: 'src/pad.ts',
        sourceDigest: digestString(PAD),
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: digestString('module'),
            name: 'pad.ts',
            path: 'module',
            startLine: 1,
            endLine: 4,
            source: true,
            testFiles: ['test/beta.test.ts'],
          },
          {
            ordinal: 1,
            kind: 'function',
            owner: 0,
            digest: digestString('pad'),
            name: 'pad',
            path: 'pad',
            startLine: 1,
            endLine: 3,
            source: true,
            testFiles: ['test/beta.test.ts'],
          },
        ],
      },
    ],
  };
}
