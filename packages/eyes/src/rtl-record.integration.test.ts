import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeExecutionIndex, recordedEyesAt } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { parseEyesJournal } from './archive.js';

const fixture = fileURLToPath(new URL('../test/fixtures/rtl-record', import.meta.url));
/** The test files, named against the checkout as every record names its files. */
const TESTS = 'packages/eyes/test/fixtures/rtl-record/test';
const REMOVE = `${TESTS}/remove.case.js > removes itself when clicked`;
const RETRY = `${TESTS}/retry.case.js > passes on its second attempt`;
const modules = fileURLToPath(new URL('../../../node_modules', import.meta.url));

function run(binary: string[], env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, binary, {
      cwd: fixture,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

/** What a run kept: the cases its index names and its journal rows. */
async function recorded(record: string) {
  const cases = decodeExecutionIndex(await readFile(record)).tests.map((test) => test.id);
  const eyes = recordedEyesAt(record);
  return { cases, eyes, rows: eyes?.journals.map((row) => [row.case, row.attempt]) };
}

/** The journal a watched RTL case hands over: its query, and the click it acted on. */
function expectRemoval(text: string): void {
  const journal = parseEyesJournal(text);
  expect(journal.complete).toBe(true);
  const kinds = journal.attention.map((entry) => entry.kind);
  expect(kinds).toContain('rtl-query');
  expect(kinds).toContain('document-event');
}

describe('an RTL journal in a recording run', () => {
  it('lands under Vitest, every attempt under the case the index names', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'variance-eyes-rtl-vitest-'));
    try {
      const record = join(scratch, 'coverage.bin');
      const vitest = await run([join(modules, 'vitest/vitest.mjs'), 'run', '--config', 'vitest.config.mjs'], {
        VARIANCE_AUTHORITY_COVERAGE: record,
      });
      expect(vitest.code, vitest.output).toBe(0);

      const { cases, eyes, rows } = await recorded(record);
      expect(cases).toEqual([REMOVE, RETRY]);
      expect(eyes?.watched).toEqual([REMOVE, RETRY]);
      // A retry is a second attempt of one case: the attempt is a column.
      expect(rows).toEqual([
        [REMOVE, 1],
        [RETRY, 1],
        [RETRY, 2],
      ]);
      expectRemoval(eyes!.journals[0]!.journal);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 120_000);

  it('lands under Rstest, every attempt under the case the index names', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'variance-eyes-rtl-rstest-'));
    try {
      const record = join(scratch, 'coverage.bin');
      // Named absolutely: Rstest resolves a relative config against the nearest package.
      const rstest = await run([join(modules, '@rstest/core/bin/rstest.js'), 'run', '-c', join(fixture, 'rstest.config.mjs')], {
        VARIANCE_AUTHORITY_COVERAGE: record,
        VARIANCE_AUTHORITY_CACHE: scratch,
      });
      expect(rstest.code, rstest.output).toBe(0);

      const { cases, eyes, rows } = await recorded(record);
      expect(cases).toEqual([REMOVE, RETRY]);
      expect(eyes?.watched).toEqual([REMOVE, RETRY]);
      expect(rows).toEqual([
        [REMOVE, 1],
        [RETRY, 1],
        [RETRY, 2],
      ]);
      expectRemoval(eyes!.journals[0]!.journal);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 120_000);

  it('lands under Jest', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'variance-eyes-rtl-jest-'));
    try {
      const record = join(scratch, 'coverage.bin');
      const jest = await run([join(modules, 'jest/bin/jest.js'), '--config', 'jest.config.mjs', '--ci'], {
        VARIANCE_AUTHORITY_COVERAGE: record,
        VARIANCE_AUTHORITY_JEST_CACHE: join(scratch, 'cache'),
      });
      expect(jest.code, jest.output).toBe(0);

      const { cases, eyes, rows } = await recorded(record);
      expect(cases).toEqual([REMOVE]);
      expect(eyes?.watched).toEqual([REMOVE]);
      expect(rows).toEqual([[REMOVE, 1]]);
      expectRemoval(eyes!.journals[0]!.journal);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 120_000);
});
