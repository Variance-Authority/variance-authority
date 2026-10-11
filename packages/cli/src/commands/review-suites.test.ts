import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OperatorError } from '../exit.js';
import { eachSuite } from './review-suites.js';

describe('reading every declared suite', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-each-suite-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('fails the whole reading on a base the change cannot be diffed from', async () => {
    const undiffed = new OperatorError('main names no commit', { kind: 'undiffed' });
    await expect(eachSuite(root, () => Promise.reject(undiffed))).rejects.toBe(undiffed);
  });

  it('keeps why a record could not answer, and whether it was never written', async () => {
    const readings = await eachSuite(root, () => Promise.reject(new OperatorError('no recording', { kind: 'unrecorded' })));
    expect(readings).toEqual([{ missed: 'no recording', unrecorded: true }]);
  });
});
