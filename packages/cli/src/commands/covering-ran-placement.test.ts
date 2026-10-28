import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { placeAcross } from '@variance-authority/sense/test-selection';
import { HOUR, MINUTE, PAY, iso, recordFixture } from './covering-record.fixture.js';

/**
 * What placing the asked region across two texts costs a `covering` answer:
 * one placement per distinct pair of texts the question compares, however many
 * runs ran over the same one.
 */

vi.mock('@variance-authority/sense/test-selection', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense/test-selection')>();
  return { ...original, placeAcross: vi.fn(original.placeAcross) };
});

const { checkout, ask } = recordFixture();

describe('a covering answer places the asked region across two texts once per pair', () => {
  it('places the asked function once for test files whose runs landed apart over the same text', async () => {
    const now = Date.now();
    const landing = (file: string, at: string) => ({ files: [file], first: at, latest: at, runs: 1, texts: {} });
    const { at } = await checkout({
      fee: true,
      runs: (_, recorded) => ({
        commit: recorded, first: iso(now - 2 * HOUR), latest: iso(now - 6 * MINUTE), runs: 2, files: ['src/fee.test.ts', 'src/pay.test.ts'],
        landings: [landing('src/pay.test.ts', iso(now - 2 * HOUR)), landing('src/fee.test.ts', iso(now - 6 * MINUTE))],
      }),
    });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount + 0;'));
    vi.mocked(placeAcross).mockClear();
    const { json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json['ran']).toMatchObject({
      stands: [
        { tests: ['src/pay.test.ts'], text: 'other', region: 'changed' },
        { tests: ['src/fee.test.ts'], text: 'other', region: 'changed' },
      ],
    });
    // `ask` reads the answer twice, as JSON and as text: one placement each.
    expect(vi.mocked(placeAcross)).toHaveBeenCalledTimes(2);
  });
});
