import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { editOf } from '@variance-authority/sense/test-selection';
import { HOUR, MINUTE, PAY, iso, recordFixture } from './covering-record.fixture.js';

/**
 * What reading the edit between two texts costs a `covering` answer about a
 * region: one reading per distinct pair of texts the question compares,
 * however many runs ran over the same one.
 */

vi.mock('@variance-authority/sense/test-selection', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense/test-selection')>();
  return { ...original, editOf: vi.fn(original.editOf) };
});

const { checkout, ask } = recordFixture();

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
    vi.mocked(editOf).mockClear();
    const { json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json['ran']).toMatchObject({
      stands: [
        { tests: ['src/pay.test.ts'], text: 'other', region: 'changed' },
        { tests: ['src/fee.test.ts'], text: 'other', region: 'changed' },
      ],
    });
    // `ask` reads the answer twice, as JSON and as text: one reading each.
    expect(vi.mocked(editOf)).toHaveBeenCalledTimes(2);
  });
});
