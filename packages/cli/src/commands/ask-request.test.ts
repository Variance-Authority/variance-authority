import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ask } from './ask.js';
import { questions } from './ask-questions.js';

/**
 * `ask` as the package exports it, called without the CLI in front: the
 * catalogue and refusals need no report.
 */

const read = (): never => {
  throw new Error('no report is read');
};

describe('`ask` called directly', () => {
  it('lists questions without reading a report when no arguments were supplied', async () => {
    expect(await ask({ report: '', read })).toBe(questions());
  });

  it.each([
    { query: 'token' },
    { unknown: [{ flag: '--verbose', typed: '--verbose' }] },
  ])('refuses arguments without a question before reading a report: %j', async (args) => {
    await expect(ask({ report: '', read, ...args })).rejects.toThrow('`variance ask` needs a question before its arguments.');
  });

  it('reads `--claims` at the question that takes it', async () => {
    const missing = join(await mkdtemp(join(tmpdir(), 'variance-ask-request-')), 'missing.json');

    await expect(ask({ question: 'adjudicate', report: '', read, claims: missing })).rejects.toThrow(
      `could not read the claims file \`${missing}\``,
    );
  });
});
