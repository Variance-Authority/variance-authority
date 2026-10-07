import type { Observation } from '@variance-authority/observe';
import { promotionOf, type ObservationRecord } from '@variance-authority/report';
import { describe, expect, it } from 'vitest';
import { adopts } from './accepted.js';
import type { VarianceRun } from './run.js';

/**
 * `--update-snapshots` is this package's accept, and `variance accept` is the
 * CLI's. A suite updated one way and a report accepted the other must adopt the
 * same images, so every verdict and document signal is asked of both:
 * `=changed` sweeps the suite as `--all` does, and `=all` adopts what a name
 * would. An image already present keeps the image rule out of the answer.
 */

const VERDICTS = ['unchanged', 'changed', 'new', 'incomparable', 'ignored'] as const;
const DOCUMENTS = [undefined, 'unchanged', 'changed'] as const;
const IDENTITIES = [undefined, 'recipe', 'machine'] as const;

const RUNS: ReadonlyArray<{ readonly flag: string; readonly run: VarianceRun; readonly bulk: boolean }> = [
  { flag: '=changed', run: { id: 'a', accepting: true, overwriting: false } as VarianceRun, bulk: true },
  { flag: '=all', run: { id: 'a', accepting: true, overwriting: true } as VarianceRun, bulk: false },
];

describe('adopts', () => {
  for (const verdict of VERDICTS) {
    for (const document of DOCUMENTS) {
      for (const identity of IDENTITIES) {
        for (const { flag, run, bulk } of RUNS) {
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

          expect(adopts(observation, run)).toBe(promotionOf(record, { bulk }).kind === 'promotable');
          });
        }
      }
    }
  }

  it("leaves another machine's image of an unchanged document to =all", () => {
    const foreign = {
      subject: 'story:a',
      verdict: 'incomparable',
      because: 'asked',
      signals: { document: 'unchanged', identity: 'machine' },
    } as unknown as Observation;
    expect(adopts(foreign, RUNS[0]!.run)).toBe(false);
    expect(adopts(foreign, RUNS[1]!.run)).toBe(true);
    const recipe = { ...foreign, signals: { document: 'unchanged', identity: 'recipe' } } as unknown as Observation;
    expect(adopts(recipe, RUNS[0]!.run)).toBe(true);
  });

  it('leaves an incomparable that does not say its document to =all', () => {
    const unsaid = { subject: 'story:a', verdict: 'incomparable', because: 'asked' } as unknown as Observation;
    expect(adopts(unsaid, RUNS[0]!.run)).toBe(false);
    expect(adopts(unsaid, RUNS[1]!.run)).toBe(true);
  });

  it('adopts nothing in a run that does not accept', () => {
    const observation = { verdict: 'changed' } as unknown as Observation;
    expect(adopts(observation, { id: 'a' } as VarianceRun)).toBe(false);
  });
});
