import { describe, it } from 'vitest';
import { lastCasesByCli, selectedByCli } from './__fixtures__/carry-contract.js';
import { CONTRACT_SEED, generated, seedsOr } from './__fixtures__/carry-histories.js';
import {
  bothRanOverAnUnkeptEdit,
  branchDeletedThenRun,
  branchDeletedThenRunElsewhere,
  commentThenRunElsewhere,
  lackedCallbackThenComment,
  lastRunAfterCarry,
  ranOverAnUnkeptTextThenAnother,
  ranOverAnotherTestsRegion,
  ranOverThenKeptForgotten,
  typeWrittenThenRunElsewhere,
} from './__fixtures__/carry-stories.js';
import { forgetKept } from './__fixtures__/carry-tree.js';

// The same histories, each last selection asked of `variance select --execution`
// in a process of its own: the record is opened cold, by the native reader. What
// `variance covering` and `variance coverage` answer is a file of its own.
describe('a record carried through a history, asked by the CLI after a restart', () => {
  it('keeps compact last-run membership through a carry and a later partial run', async () => {
    await lastRunAfterCarry(selectedByCli, lastCasesByCli);
  });

  it('selects an edit in each effect by the test that ran it after a comment and a run of other tests', async () => {
    await commentThenRunElsewhere(selectedByCli);
  });

  it('gives a callback its cut lacked the cases around it, never its same-named sibling\'s', async () => {
    await lackedCallbackThenComment(selectedByCli);
  });

  it('keeps the top level\'s load evidence when a run lands over a deleted branch that renumbered its sibling', async () => {
    await branchDeletedThenRun(selectedByCli);
  });

  it('keeps the top level\'s load evidence when a run of other tests carries the record over that deletion', async () => {
    await branchDeletedThenRunElsewhere(selectedByCli);
  });

  it('keeps every case and the load evidence when a run of other tests carries the record over a type written at the top', async () => {
    await typeWrittenThenRunElsewhere(selectedByCli);
  });

  it('skips a test that ran over a kept edit and owes the one carried from the earlier text, and charges every loader once the text is forgotten', async () => {
    await ranOverThenKeptForgotten(selectedByCli, forgetKept);
  });

  it('charges every loader when both tests ran over an uncommitted edit and no text was kept, since the digest cannot stand in for it', async () => {
    await bothRanOverAnUnkeptEdit(selectedByCli, forgetKept);
  });

  it('keeps the case that ran a region in another text on it, run by an edit there and named by no reader, when a run over an edit inside it did not enter it', async () => {
    await ranOverAnotherTestsRegion(selectedByCli);
  });

  it('holds every case of a module flagged at each of its regions when a run lands over a text no landing kept, never as measured absence', async () => {
    await ranOverAnUnkeptTextThenAnother(selectedByCli, forgetKept);
  });

});

// The contract's seed, the last selection asked of the CLI for the labels the
// three faults move: the callbacks and the top level. A replay here is a
// process per selection, so a failing one is not shrunk: the in-process run
// plays the same seed and shrinks it.
describe('a record carried through a generated history, asked by the CLI after a restart', () => {
  it.each(seedsOr([CONTRACT_SEED]))('stays within the fixture\'s bounds for seed %i', async (seed) => {
    await generated(seed, selectedByCli, { asked: ['top', 'first', 'second'], replays: 0 });
  });
});
