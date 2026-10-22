import { describe, it } from 'vitest';
import { comparedByCli } from './__fixtures__/carry-comparison.js';
import { lastCasesByCli, selectedByCli } from './__fixtures__/carry-contract.js';
import { CONTRACT_SEED, generated, seedsOr } from './__fixtures__/carry-histories.js';
import {
  branchDeletedThenRun,
  branchDeletedThenRunElsewhere,
  commentThenRunElsewhere,
  importEditedThenRunElsewhere,
  lackedCallbackThenComment,
  lastRunAfterCarry,
  typeWrittenThenRunElsewhere,
} from './__fixtures__/carry-stories.js';

// The same histories, each last selection asked of `variance select --execution`
// in a process of its own: the record is opened cold, by the native reader.
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

  it('compares a top level whose carried cases an import edit dropped as unmeasured, never as no longer run', async () => {
    await importEditedThenRunElsewhere(comparedByCli);
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
