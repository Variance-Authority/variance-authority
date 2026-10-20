import { describe, it } from 'vitest';
import { comparedInProcess } from './__fixtures__/carry-comparison.js';
import { selected } from './__fixtures__/carry-contract.js';
import { generated, seedsOr } from './__fixtures__/carry-histories.js';
import {
  branchDeletedThenRun,
  branchDeletedThenRunElsewhere,
  commentThenRunElsewhere,
  importEditedThenRunElsewhere,
  lackedCallbackThenComment,
  typeWrittenThenRunElsewhere,
} from './__fixtures__/carry-stories.js';

describe('a record carried through a history, asked in-process', () => {
  it('selects nothing for a comment and, after a run of other tests, selects an edit in each effect by the test that ran it', async () => {
    await commentThenRunElsewhere(selected);
  });

  it('gives a callback its cut lacked the cases around it, never its same-named sibling\'s', async () => {
    await lackedCallbackThenComment(selected);
  });

  it('keeps the top level\'s cases and load evidence when a run lands over a deleted branch that renumbered its sibling', async () => {
    await branchDeletedThenRun(selected);
  });

  it('keeps the top level\'s cases and load evidence when a run of other tests carries the record over that deletion', async () => {
    await branchDeletedThenRunElsewhere(selected);
  });

  it('keeps every case and the load evidence when a run of other tests carries the record over a type written at the top', async () => {
    await typeWrittenThenRunElsewhere(selected);
  });

  it('compares a top level whose carried cases an import edit dropped as unmeasured, never as no longer run', async () => {
    await importEditedThenRunElsewhere(comparedInProcess);
  });
});

// One seed, fixed so a run is reproducible, and chosen as the one of seeds
// 4830-4869 whose history every fault a seed catches fails: a carry that reads
// lines only, one that pairs regions blind to their population, and one that
// refuses the top level, in TypeScript and in the native layer. CARRY_SEED
// replays another.
describe('a record carried through a generated history, asked in-process', () => {
  it.each(seedsOr([4839]))('stays within the fixture\'s bounds for seed %i', async (seed) => {
    await generated(seed, selected, { replays: 3 });
  });
});
