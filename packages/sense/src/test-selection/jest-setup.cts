/**
 * The half of the Jest seam that writes a test file's journal.
 *
 * Named in `setupFilesAfterEnv` by `withTestSelection`, so Jest evaluates it in
 * every test file's context before the file itself. `afterAll` and `expect`
 * come from `@jest/globals`, which the runtime answers inside the sandbox
 * whether or not the project injects globals. CommonJS on purpose: a file
 * under `node_modules` is not transformed, so an ES `import` here would be a
 * syntax error in every project that did not opt into ES modules.
 *
 * The counters it reads belong to the factory `jest-globals.cts` installs — a
 * `Uint32Array` per module, nothing per probe beyond an increment — and it
 * writes one journal per test file to the run directory the reporter named,
 * from `afterAll`, synchronously. The journal never crosses the worker's IPC
 * channel and never accumulates: a run of twenty thousand files is twenty
 * thousand small files on disk, not one map in the parent's heap.
 */

import globals = require('@jest/globals');
import fs = require('node:fs');
import crypto = require('node:crypto');
import install = require('./jest-globals.cjs');

/** Mirrors `EVALUATING` in `../instrument/index.ts`; a bare number because this file cannot import it. */
const EVALUATING = 0x80000000;

const { afterAll, expect } = globals;

// Installed by `setupFiles` already in a configuration `withTestSelection`
// wrote; installed here for one that named this file alone.
const { modules } = install();

afterAll(() => {
  const runDirectory = process.env['VARIANCE_AUTHORITY_TEST_SELECTION_RUN'];
  if (runDirectory === undefined) {
    throw new Error(
      'variance-authority has no run directory: the reporter withTestSelection adds must be configured too',
    );
  }
  const testFile = expect.getState().testPath;
  if (testFile === undefined) throw new Error('variance-authority could not identify the current Jest file');

  const journal = {
    testFile,
    modules: [...modules].map(([file, counters]) => {
      const hits: number[] = [];
      const shared: number[] = [];
      for (let ordinal = 0; ordinal < counters.length; ordinal += 1) {
        const count = counters[ordinal]!;
        if (count === 0) continue;
        hits.push(ordinal);
        if (count >= EVALUATING) shared.push(ordinal);
      }
      return { file, hits, shared };
    }),
  };
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(
    `${runDirectory}/${process.pid}-${crypto.randomUUID()}.json`,
    JSON.stringify(journal),
  );
});
