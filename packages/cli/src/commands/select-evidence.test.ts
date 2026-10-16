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
 * `variance select` in a suite that declares the evidence it trusts.
 *
 * `src/pad.ts` is imported by three tests. `alpha` loaded it, `beta` called
 * `pad`, and `gamma` ran nothing of it. A line inside `pad` changes, and the
 * plain output names the tests the run skips.
 */
describe('the evidence a suite declares, read by `variance select`', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-evidence-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs the test that entered the changed region when the suite declares nothing', async () => {
    expect(await skipped(undefined)).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
  });

  it('runs every test that loaded the changed file at file use', async () => {
    expect(await skipped('file-use')).toBe('test/gamma.test.ts\n');
  });

  it('runs every test that imports the changed file at file, whatever it ran', async () => {
    expect(await skipped('file')).toBe('');
  });
});

async function skipped(evidence: string | undefined): Promise<string> {
  const root = await recorded({ suites: { unit: { kind: 'unit', ...(evidence === undefined ? {} : { evidence }) } } });
  write(root, 'src/pad.ts', PAD.replace('padStart(4', 'padStart(5'));
  return (await selectOutput({ cwd: root, format: 'plain', suite: 'unit' })).out;
}

const PAD = ['export function pad(text: string): string {', "  return text.padStart(4, ' ');", '}', ''].join('\n');
const TEST = (name: string, body: string) =>
  `import { expect, it } from 'vitest';\nimport { pad } from '../src/pad';\nit('${name}', () => ${body});\n`;

const FILES: Readonly<Record<string, string>> = {
  'src/pad.ts': PAD,
  'test/alpha.test.ts': TEST('loads', 'expect(typeof pad).toBe("function")'),
  'test/beta.test.ts': TEST('pads', "expect(pad('x')).toBe('   x')"),
  'test/gamma.test.ts': TEST('names', 'expect(pad.name).toBe("pad")'),
  'package.json': JSON.stringify({ name: 'fixture' }),
};

/** A checkout with `config` at its root, its index built, and a record of three tests at its head. */
async function recorded(config: unknown): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-select-evidence-'));
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

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** `src/pad.ts`: its module region entered by alpha and beta, `pad` by beta alone. */
function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: ['alpha', 'beta', 'gamma'].map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
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
            testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
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
