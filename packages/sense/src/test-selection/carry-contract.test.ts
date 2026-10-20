import { describe, it } from 'vitest';
import { comparedInProcess } from './__fixtures__/carry-comparison.js';
import { selected } from './__fixtures__/carry-contract.js';
import {
  branchDeletedThenRun,
  branchDeletedThenRunElsewhere,
  commentThenRunElsewhere,
  importEditedThenRunElsewhere,
  lackedCallbackThenComment,
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

  it('compares a top level whose carried cases an import edit dropped as unmeasured, never as no longer run', async () => {
    await importEditedThenRunElsewhere(comparedInProcess);
  });
});
