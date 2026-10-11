import type { Observation } from '@variance-authority/observe';
import { promotionOf, type ObservationRecord } from '@variance-authority/report';
import { describe, expect, it } from 'vitest';
import { adopts } from './accepted.js';
import type { VarianceRun } from './run.js';

/**
 * `--update-snapshots` is this package's accept, and `variance accept` is the
 * CLI's. A suite updated one way and a report accepted the other must adopt the
 * same images, so every verdict and identity signal is asked of both. An image
 * already present keeps the image rule out of the answer.
 */

const VERDICTS = ['unchanged', 'changed', 'new', 'ignored'] as const;
const DOCUMENTS = [undefined, 'unchanged', 'changed'] as const;
const IDENTITIES = [undefined, 'recipe', 'machine'] as const;

const RUNS: ReadonlyArray<{ readonly flag: string; readonly run: VarianceRun }> = [
  { flag: '=changed', run: { id: 'a', accepting: true } as VarianceRun },
  { flag: '=all', run: { id: 'a', accepting: true } as VarianceRun },
];

describe('adopts', () => {
  for (const verdict of VERDICTS) {
    for (const document of DOCUMENTS) {
      for (const identity of IDENTITIES) {
        for (const { flag, run } of RUNS) {
          const named = `${verdict}, document ${String(document)}, identity ${String(identity)}, under ${flag}`;
          it(`agrees with variance accept on ${named}`, () => {
          const signals =
            document === undefined ? {} : { signals: { document, ...(identity === undefined ? {} : { identity }) } };
          const record: ObservationRecord = {
            subject: 'story:a',
            verdict,
            because: 'asked',
            changedPixels: 0,
            regions: [],
            images: { after: 'images/story%3Aa.after.png' },
            ...signals,
          };
          const observation = { subject: 'story:a', verdict, because: 'asked', ...signals } as unknown as Observation;

          expect(adopts(observation, run)).toBe(promotionOf(record).kind === 'promotable');
          });
        }
      }
    }
  }

  it("adopts another machine's change under either flag", () => {
    const foreign = {
      subject: 'story:a',
      verdict: 'changed',
      because: 'asked',
      signals: { document: 'unchanged', identity: 'machine', moved: ['engine chromium@131 → chromium@132'] },
    } as unknown as Observation;
    expect(adopts(foreign, RUNS[0]!.run)).toBe(true);
    expect(adopts(foreign, RUNS[1]!.run)).toBe(true);
  });

  it('re-stamps an unchanged subject under a moved identity', () => {
    const unmoved = {
      subject: 'story:a',
      verdict: 'unchanged',
      because: 'asked',
      signals: { identity: 'recipe', moved: ['rasterization e5ed66c6 → 865368fe'] },
    } as unknown as Observation;
    expect(adopts(unmoved, RUNS[0]!.run)).toBe(true);
  });

  it('adopts nothing in a run that does not accept', () => {
    const observation = { verdict: 'changed' } as unknown as Observation;
    expect(adopts(observation, { id: 'a' } as VarianceRun)).toBe(false);
  });
});
