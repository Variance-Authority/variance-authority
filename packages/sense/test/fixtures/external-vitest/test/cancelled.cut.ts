import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

// The worker's own cancel signal, which is the only thing a running test can
// wait on to know the run was cancelled. Waiting for it rather than for a clock
// makes the cut land between these two tests on any machine: the runner hears
// the cancel before this test resumes, so the second test is the one it cuts.
const worker = (globalThis as { __vitest_worker__?: { onCancel?: Promise<unknown> } }).__vitest_worker__;
const never = new Promise<never>(() => {});

it('takes the alpha path, and is still running when the run is cancelled', async () => {
  const started = process.env['CUT_STARTED'];
  if (started === undefined) throw new Error('CUT_STARTED is required');
  writeFileSync(started, '');
  await Promise.race([worker?.onCancel ?? never, new Promise((settle) => setTimeout(settle, 4_000))]);
  expect(decide('alpha')).toBe('A');
});

it('takes the gamma path, which no other test in this file reaches', () => {
  expect(decide('gamma')).toBe('G');
});
