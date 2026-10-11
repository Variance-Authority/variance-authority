/**
 * A journey that is the first to need a module evaluates it, and calls into it
 * afterwards. The stitch gives what a module ran while it evaluated to every
 * subject, wherever it ran, so the journey that evaluated it is read as it
 * would be had the module evaluated before any journey began.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { collectJourneys, mintJourney } from './journey.js';
import { selectTestFiles } from './index.js';
import {
  LAZY,
  LAZY_DOLLAR_LINE,
  LAZY_EURO_LINE,
  type Currency,
  diffAt,
  driver,
  evaluate,
  forget,
  head,
  inRoot,
  record,
} from './__fixtures__/journey-head.js';

afterEach(forget);

describe('a journey that evaluates a module and calls into it', () => {
  // `label("de")` runs at the top level, and the German journey calls
  // `label("de")` again: the region and its branch are entered both ways.
  it('is stitched and recorded as a journey that found the module evaluated', async () => {
    const readings = new Map<string, unknown>();
    for (const inline of [false, true]) {
      await forget();
      await inRoot(async (root) => {
        const driven = await driver();
        const collector = collectJourneys({ head: 'api', enabled: true });
        const parts = await head(root, 'build', { source: LAZY, lazy: true });
        const german = mintJourney();
        const english = mintJourney();

        let loaded: Currency | undefined = inline ? undefined : evaluate(parts.code);
        await collector.enter(driven.carrying(german), () => {
          loaded ??= evaluate(parts.code);
          return loaded('de');
        });
        await collector.enter(driven.carrying(english), () => loaded!('en'));
        await collector.close();
        const { stitched } = await record(root, parts, driven, [
          [german, 'euros.spec.ts'],
          [english, 'dollars.spec.ts'],
        ]);

        const selected: Record<number, readonly string[]> = {};
        for (let line = 1; line <= LAZY.split('\n').length; line += 1) {
          selected[line] = await selectTestFiles(parts.where.coverageFile, diffAt('currency.js', line));
        }
        readings.set(inline ? 'inline' : 'eager', {
          subjects: stitched.heads.get('api')!.map((subject) => ({
            owner: subject.owner,
            modules: subject.journal.modules.map(({ hits, shared }) => ({ hits, shared })),
          })),
          selected,
        });
      });
    }

    expect(readings.get('inline')).toEqual(readings.get('eager'));
    expect(readings.get('eager')).toMatchObject({
      selected: { [LAZY_EURO_LINE]: ['dollars.spec.ts', 'euros.spec.ts'], [LAZY_DOLLAR_LINE]: ['dollars.spec.ts'] },
    });
  });
});
