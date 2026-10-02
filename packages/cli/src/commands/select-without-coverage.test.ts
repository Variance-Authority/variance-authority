import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, recordOfCases, testCoverageFile } from '@variance-authority/sense/test-selection';
import { journeyAgainst, recordedJourneys } from './resources.js';
import { selectOutput } from './select-command.js';

/**
 * A record whose run kept its cases and instrumented no module holds no
 * coverage (spec 0094, item 2). Absent coverage is unmeasured, not a record of
 * tests that reach nothing, so every reader of it narrows nothing.
 */
describe('a record without coverage', () => {
  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-uncovered-cache-'));
  });

  afterEach(() => {
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  /** A checkout whose record holds the cases of `a.test.ts` and no coverage, as `landRun` writes it. */
  function uncovered(): string {
    const root = mkdtempSync(join(tmpdir(), 'va-select-uncovered-'));
    const file = testCoverageFile(root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, recordOfCases({
      index: encodeExecutionIndex({
        tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one', stopped: false }],
        modules: [{
          file: 'src/a.ts',
          blocks: [{ kind: 'function', name: 'a', path: 'a', startLine: 1, endLine: 1, source: true, crossings: [{ test: 0, distance: 0 }] }],
        }],
      }),
    }));
    return root;
  }

  it('skips nothing under `variance select`, and says the record holds no coverage', async () => {
    const root = uncovered();

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('');
    expect(said.err).toContain(`skipping nothing: the record at ${testCoverageFile(root)} holds no coverage`);
  });

  it('narrows nothing for `variance run --since`, which reads it as no record', async () => {
    const root = uncovered();

    await expect(journeyAgainst(root, '', undefined, testCoverageFile(root))).resolves.toBeUndefined();
  });

  it('carries no partings for `variance journeys`, which says where the record it wanted would be', async () => {
    const root = uncovered();

    await expect(recordedJourneys(root, undefined, testCoverageFile(root))).resolves.toEqual({ at: testCoverageFile(root) });
  });
});
