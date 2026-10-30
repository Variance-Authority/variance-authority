import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HOUR, MINUTE, PAY, iso, recordFixture } from './covering-record.fixture.js';

/**
 * What reading the edit between two texts costs a `covering` answer about a
 * region: one reading per distinct pair of texts the question compares,
 * however many runs ran over the same one.
 */

vi.mock('@variance-authority/sense/test-selection', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense/test-selection')>();
  // Every pair of texts a reader of edits is asked for, by file and the two names.
  const editsBetween: typeof original.editsBetween = (...args) => {
    const edits = original.editsBetween(...args);
    return (file, from, to) => {
      asked.push(`${file} ${from} ${to}`);
      return edits(file, from, to);
    };
  };
  return { ...original, editsBetween: vi.fn(editsBetween) };
});

const { checkout, ask } = recordFixture();
/** The pairs of texts the readers of edits were asked for, the same pair read once. */
const asked: string[] = [];
/** The distinct pairs of two different texts asked: each is one reading of an edit. */
const read = () => new Set(asked.filter((pair) => { const [, from, to] = pair.split(' '); return from !== to; })).size;


describe('a covering answer reads the edit between two texts once per pair', () => {
  it('reads the edit under the asked function once for test files whose runs landed apart over the same text', async () => {
    const now = Date.now();
    const landing = (file: string, at: string) => ({ files: [file], first: at, latest: at, runs: 1, texts: {} });
    const { at } = await checkout({
      fee: true,
      runs: (_, recorded) => ({
        commit: recorded, latest: iso(now - 6 * MINUTE), runs: 2,
        landings: [landing('src/pay.test.ts', iso(now - 2 * HOUR)), landing('src/fee.test.ts', iso(now - 6 * MINUTE))],
      }),
    });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount + 0;'));
    asked.length = 0;
    const { json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json['ran']).toMatchObject({
      stands: [
        { tests: ['src/pay.test.ts'], text: 'other', region: 'changed' },
        { tests: ['src/fee.test.ts'], text: 'other', region: 'changed' },
      ],
    });
    // Both runs ran the same text: one pair of texts for the two of them.
    expect(read()).toBe(1);
  });
});
