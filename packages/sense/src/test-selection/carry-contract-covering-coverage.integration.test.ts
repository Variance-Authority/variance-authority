import { describe, it } from 'vitest';
import { comparedByCli } from './__fixtures__/carry-comparison.js';
import { ranByCli } from './__fixtures__/carry-ran.js';
import { sinceByCli } from './__fixtures__/carry-since.js';
import {
  changeRecordedThenAsked,
  importEditedThenRunElsewhere,
  ranOverThenCommittedElsewhere,
  renamedThenEdited,
} from './__fixtures__/carry-stories.js';
import { forgetKept } from './__fixtures__/carry-tree.js';

// The same histories, each last answer asked of `variance covering` or
// `variance coverage --against` in a process of its own: the record is opened
// cold, by the native reader. What `variance select` answers is carry-contract.
describe('a record carried through a history, asked by the CLI after a restart', () => {
  it('dates a test file by the landing it last ran in, never by a later one that carried it, and holds the text it ran over only while it is kept or committed', async () => {
    await ranOverThenCommittedElsewhere(ranByCli, forgetKept);
  });

  it('answers for a change the record already holds by the test that entered it, and for what it does not hold beside it', async () => {
    await changeRecordedThenAsked(sinceByCli);
  });

  it('holds nothing of a file the mainline renamed, the record having run it under the old path', async () => {
    await renamedThenEdited(sinceByCli);
  });

  it('compares a top level whose carried cases an import edit dropped as unmeasured, never as no longer run', async () => {
    await importEditedThenRunElsewhere(comparedByCli);
  });
});
