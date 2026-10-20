import { describe, it } from 'vitest';
import { selectedByCli } from './__fixtures__/carry-contract.js';
import {
  branchDeletedThenRun,
  branchDeletedThenRunElsewhere,
  commentThenRunElsewhere,
  lackedCallbackThenComment,
} from './__fixtures__/carry-stories.js';

// The same histories, each last selection asked of `variance select --execution`
// in a process of its own: the record is opened cold, by the native reader.
describe('a record carried through a history, asked by the CLI after a restart', () => {
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
});
