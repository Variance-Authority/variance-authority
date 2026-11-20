import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ask } from './ask.js';
import { questions } from './ask-questions.js';

/**
 * `ask` as the package exports it, called without the CLI in front: a caller
 * that passes no `warn` still hears what was answered past, on standard error.
 */

const read = (): never => {
  throw new Error('no report is read');
};

describe('`ask` called directly', () => {
  it('names an unknown flag on standard error beside the list of questions, with no `warn` given', async () => {
    const written: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      const unknown = [{ flag: '--verbose', typed: '--verbose', next: 0 }];

      expect(await ask({ report: '', read, unknown })).toBe(questions());
      expect(written).toEqual([
        'variance: `--verbose` is not an argument `variance ask` takes, so the list of questions is what it is without it; a flag goes after its question.\n',
      ]);
    } finally {
      stderr.mockRestore();
    }
  });

  it('reads `--claims` at the question that takes it', async () => {
    const missing = join(await mkdtemp(join(tmpdir(), 'variance-ask-request-')), 'missing.json');

    await expect(ask({ question: 'adjudicate', report: '', read, claims: missing })).rejects.toThrow(
      `could not read the claims file \`${missing}\``,
    );
  });
});
