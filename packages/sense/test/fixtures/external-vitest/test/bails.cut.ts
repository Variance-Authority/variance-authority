import { existsSync } from 'node:fs';
import { it } from 'vitest';

// Fails once `cancelled.cut.ts` is part-way through, so `--bail 1` cancels the
// run while that file still has a test left to run.
it('fails once the other file has started', async () => {
  const started = process.env['CUT_STARTED'];
  if (started === undefined) throw new Error('CUT_STARTED is required');
  while (!existsSync(started)) await new Promise((settle) => setTimeout(settle, 10));
  throw new Error('the failure `--bail 1` cancels the run on');
});
