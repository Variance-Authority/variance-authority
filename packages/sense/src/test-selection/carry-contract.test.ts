import { describe, it } from 'vitest';
import { comparedInProcess } from './__fixtures__/carry-comparison.js';
import { lastCases, selected } from './__fixtures__/carry-contract.js';
import { CONTRACT_SEED, generated, seedsOr } from './__fixtures__/carry-histories.js';
import {
  bothRanOverAnUnkeptEdit,
  branchDeletedThenRun,
  branchDeletedThenRunElsewhere,
  commentThenRunElsewhere,
  importEditedThenRunElsewhere,
  lackedCallbackThenComment,
  lastRunAfterCarry,
  ranOverThenKeptForgotten,
  typeWrittenThenRunElsewhere,
} from './__fixtures__/carry-stories.js';
import { forgetKept, selectedFromTree } from './__fixtures__/carry-tree.js';

describe('a record carried through a history, asked in-process', () => {
  it('keeps compact last-run membership through a carry and a later partial run', async () => {
    await lastRunAfterCarry(selected, lastCases);
  });

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

  it('skips a test that ran over a kept edit and owes the one carried from the earlier text, and charges every loader once the text is forgotten', async () => {
    await ranOverThenKeptForgotten(selectedFromTree, forgetKept);
  });

  it('charges every loader when both tests ran over an uncommitted edit and no text was kept, since the digest cannot stand in for it', async () => {
    await bothRanOverAnUnkeptEdit(selectedFromTree, forgetKept);
  });

  it('compares a top level whose carried cases an import edit dropped as unmeasured, never as no longer run', async () => {
    await importEditedThenRunElsewhere(comparedInProcess);
  });
});

describe('a record carried through a generated history, asked in-process', () => {
  it.each(seedsOr([CONTRACT_SEED]))('stays within the fixture\'s bounds for seed %i', async (seed) => {
    await generated(seed, selected, { replays: 3 });
  });
});
