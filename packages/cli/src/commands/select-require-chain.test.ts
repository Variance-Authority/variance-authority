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
 * `variance select` over a changed file the record holds no row for, which
 * only a measured module loads: no transform saw it, as when a runner hands a
 * CommonJS module Node's own `require`. The change goes to the measured
 * importer. Where the reading names what the file exports, the importer's
 * reads of it narrow that to the tests that entered them; where it names none,
 * as of `module.exports`, the importer answers whole.
 */
describe('a changed file only a measured module loads', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-require-chain-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it.each([
    // The import of `twice` is read inside `sum`, which `sum.test` alone entered.
    { format: 'an ES module', fixture: 'esm', twice: 'twice.mjs', index: 'index.mjs', skipped: ['test/beta.test.ts', 'test/load.test.ts'] },
    // `module.exports` names no export the reading can follow, so every test that loaded the importer runs.
    { format: 'CommonJS', fixture: 'cjs', twice: 'twice.cjs', index: 'index.cjs', skipped: ['test/beta.test.ts'] },
    // An ES module that exports nothing has no name to follow either.
    { format: 'an ES module that exports nothing', fixture: 'bare', twice: 'twice.mjs', index: 'index.mjs', skipped: ['test/beta.test.ts'] },
  ])('answers a change in $format by the importer that loads it', async ({ fixture, twice, index, skipped }) => {
    const sources = SOURCES[fixture]!;
    const root = await recorded(fixture, twice, index);

    write(root, `src/${twice}`, sources.twice.replace('n * 2', 'n * 3'));
    const said = await selectOutput({ cwd: root, format: 'plain' });

    // The plain format lists what is skipped.
    expect(said.out).toBe(skipped.map((file) => `${file}\n`).join(''));
    expect(said.err).toContain(`skipping ${skipped.length} of 3 test files recorded whole`);
  });
});

const SOURCES: Record<string, { readonly twice: string; readonly index: string }> = {
  esm: {
    twice: ['export function twice(n) {', '  return n * 2;', '}', ''].join('\n'),
    index: ["import { twice } from './twice.mjs';", 'export function sum(n) {', '  return twice(n) + 1;', '}', ''].join('\n'),
  },
  cjs: {
    twice: ['function twice(n) {', '  return n * 2;', '}', 'module.exports = { twice };', ''].join('\n'),
    index: ["const { twice } = require('./twice.cjs');", 'function sum(n) {', '  return twice(n) + 1;', '}', 'module.exports = { sum };', ''].join('\n'),
  },
  bare: {
    twice: ['globalThis.twice = function twice(n) {', '  return n * 2;', '};', ''].join('\n'),
    index: ["import './twice.mjs';", 'export function sum(n) {', '  return globalThis.twice(n) + 1;', '}', ''].join('\n'),
  },
};
const PAD = ['export function pad(text: string): string {', "  return text.padStart(4, ' ');", '}', ''].join('\n');

/** A checkout whose `src/<index>` loads `src/<twice>`, its index built, and a record at its head. */
async function recorded(fixture: string, twice: string, index: string): Promise<string> {
  const { twice: twiceText, index: indexText } = SOURCES[fixture]!;
  const root = mkdtempSync(join(tmpdir(), 'va-select-require-chain-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const all: Record<string, string> = {
    [`src/${twice}`]: twiceText,
    [`src/${index}`]: indexText,
    'src/pad.ts': PAD,
    'test/sum.test.ts': `import { expect, it } from 'vitest';\nimport { sum } from '../src/${index}';\nit('sums', () => expect(sum(2)).toBe(5));\n`,
    'test/load.test.ts': `import { expect, it } from 'vitest';\nimport { sum } from '../src/${index}';\nit('loads', () => expect(typeof sum).toBe('function'));\n`,
    'test/beta.test.ts': "import { expect, it } from 'vitest';\nimport { pad } from '../src/pad';\nit('pads', () => expect(pad('x')).toBe('   x'));\n",
    'package.json': JSON.stringify({ name: 'fixture' }),
  };
  for (const [file, text] of Object.entries(all)) write(root, file, text);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  await writeTestCoverage(testCoverageFile(root), snapshot(git(['rev-parse', 'HEAD']), index, indexText));
  process.chdir(root);
  await indexOutput({ cwd: root });
  return root;
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** `src/<index>`, loaded by sum and load and entered at `sum` by sum alone; the file it loads has no row. */
function snapshot(commit: string, index: string, indexText: string): TestCoverage {
  const lines = indexText.split('\n').length - 1;
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/beta.test.ts', complete: true, preconditions: [] },
      { file: 'test/load.test.ts', complete: true, preconditions: [] },
      { file: 'test/sum.test.ts', complete: true, preconditions: [] },
    ],
    modules: [
      {
        file: `src/${index}`,
        sourceDigest: digestString(indexText),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: digestString('module'), name: index, path: 'module', startLine: 1, endLine: lines, source: true, testFiles: ['test/load.test.ts', 'test/sum.test.ts'] },
          { ordinal: 1, kind: 'function', owner: 0, digest: digestString('sum'), name: 'sum', path: 'sum', startLine: 2, endLine: 4, source: true, testFiles: ['test/sum.test.ts'] },
        ],
      },
      {
        file: 'src/pad.ts',
        sourceDigest: digestString(PAD),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: digestString('module'), name: 'pad.ts', path: 'module', startLine: 1, endLine: 4, source: true, testFiles: ['test/beta.test.ts'] },
          { ordinal: 1, kind: 'function', owner: 0, digest: digestString('pad'), name: 'pad', path: 'pad', startLine: 1, endLine: 3, source: true, testFiles: ['test/beta.test.ts'] },
        ],
      },
    ],
  };
}
