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
 * `variance select` over a file the suite's record did not measure.
 *
 * The record has no row for it, so the import graph names its audience: the
 * first tests that import it. A suite that declares `relations: false` takes
 * no such answer — an e2e suite reaches the app through a browser, and the
 * graph would name a unit test's neighbour — and the file keeps no test in the
 * run, named as declined.
 */
describe('a changed file the record did not measure', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-route-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs the first tests that import it', async () => {
    const root = await recorded({ suites: { unit: { kind: 'unit' } } });

    write(root, 'src/feature.ts', FEATURE.replace('1', '2'));
    const said = await select(root);

    expect(said.out).toBe('test/beta.test.ts\n');
    expect(said.err).not.toContain('declines relations');
  });

  it('runs none of them in a suite that declines relations, and names the file declined', async () => {
    const root = await recorded({ suites: { unit: { kind: 'unit', relations: false } } });

    write(root, 'src/feature.ts', FEATURE.replace('1', '2'));
    const said = await select(root);

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\n');
    expect(said.err).toContain('the suite declines relations, so 1 changed file its record did not measure (src/feature.ts)');
    expect(said.err).not.toContain('records nothing');
  });

  it('still answers a measured file by its regions in a suite that declines relations', async () => {
    const root = await recorded({ suites: { unit: { kind: 'unit', relations: false } } });

    write(root, 'src/pad.ts', PAD.replace('padStart(4', 'padStart(5'));
    const said = await select(root);

    expect(said.out).toBe('test/alpha.test.ts\n');
    expect(said.err).not.toContain('declines relations');
  });
});

const PAD = ['export function pad(text: string): string {', "  return text.padStart(4, ' ');", '}', ''].join('\n');
const FEATURE = 'export const feature = 1;\n';

const FILES: Readonly<Record<string, string>> = {
  'src/pad.ts': PAD,
  'src/feature.ts': FEATURE,
  'test/alpha.test.ts': "import { expect, it } from 'vitest';\nimport { feature } from '../src/feature';\nit('reads', () => expect(feature).toBe(1));\n",
  'test/beta.test.ts': "import { expect, it } from 'vitest';\nimport { pad } from '../src/pad';\nit('pads', () => expect(pad('x')).toBe('   x'));\n",
  'package.json': JSON.stringify({ name: 'fixture' }),
};

/** A checkout with `config` at its root, its index built, and a record of two tests at its head. */
async function recorded(config: unknown): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-select-route-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  for (const [file, text] of Object.entries(FILES)) write(root, file, text);
  write(root, 'variance.config.json', JSON.stringify(config));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  await writeTestCoverage(testCoverageFile(root, { suite: 'unit' }), snapshot(git(['rev-parse', 'HEAD'])));
  process.chdir(root);
  await indexOutput({ cwd: root });
  return root;
}

async function select(root: string) {
  return await selectOutput({ cwd: root, format: 'plain', suite: 'unit' });
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
