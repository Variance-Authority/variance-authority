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
 * `Uint32Array` per module, nothing per probe beyond an increment — and they go
 * to the run directory the reporter named as a frame, from `afterAll`,
 * synchronously. The counters are never turned into rows on the way: what the
 * suite is charged for here is one pass over each array. The journal never
 * crosses the worker's IPC channel and never accumulates — a run of twenty
 * thousand files is twenty thousand small files on disk, not one map in the
 * parent's heap.
 */

import globals = require('@jest/globals');
import fs = require('node:fs');
import crypto = require('node:crypto');
import install = require('./jest-globals.cjs');
import journals = require('./journal-format.cjs');
import type { ModuleId } from '../instrument/index.js';

const { afterAll, beforeAll, expect } = globals;

// Installed by `setupFiles` already in a configuration `withTestSelection`
// wrote; installed here for one that named this file alone.
const { modules } = install();

// What had run before the file's first test: Jest evaluates the file to
// collect its tests, then runs the hooks, so every module the file imports has
// been evaluated by now and whatever its top level called has been counted.
const loaded = new Map<ModuleId, Uint32Array>();
beforeAll(() => {
  for (const [id, counters] of modules) loaded.set(id, counters.slice());
});

afterAll(() => {
  const runDirectory = process.env['VARIANCE_AUTHORITY_TEST_SELECTION_RUN'];
  if (runDirectory === undefined) {
    throw new Error(
      'variance-authority has no run directory: the reporter withTestSelection adds must be configured too',
    );
  }
  const testFile = expect.getState().testPath;
  if (testFile === undefined) throw new Error('variance-authority could not identify the current Jest file');

  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(
    `${runDirectory}/${process.pid}-${crypto.randomUUID()}.va`,
    journals.encodeJournal(testFile, modules, loaded),
  );
});
