import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

/** Built, as the tap loads it: the parts `require` the story format by its built name. */
const storyParts = createRequire(import.meta.url)('../../dist/instrument/story-parts.cjs') as typeof import('./story-parts.cjs');

it('opens no segment for a part that kept none of the visits, however often its execution resumes', () => {
  const root = { a: 0, s: null };
  let key = '';
  const parts = storyParts.createParts({ root, current: () => ({ key }) }, storyParts.PART_LIMIT, {
    // A module whose row alone is past what a part's text holds.
    ids: ['m'.repeat(400 << 10)],
    bases: [0],
  });

  for (let switched = 0; switched < 1000; switched += 1) {
    key = switched % 2 === 0 ? 'a' : 'b';
    root.a += 1;
    parts.tape(0);
  }

  const taken = parts.take('a')!;
  expect([taken.tape.length, taken.at.length, taken.visits]).toEqual([0, 0, 500]);
});
