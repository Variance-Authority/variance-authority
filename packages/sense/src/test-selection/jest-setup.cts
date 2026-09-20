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
 *
 * Where the run asked for per-case crossings this file is also where a case
 * scope is opened. Jest has no seam that *wraps* a test the way Vitest's
 * `runTask` does, so the wrapping is done to `test` and `it` themselves: the
 * body a file registers is registered enclosed, which is the enclosure an
 * {@link AsyncLocalStorage} needs and the thing `beforeEach` and `afterEach`
 * can never be.
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
const collector = install();

// What had run before the file's first test: Jest evaluates the file to
// collect its tests, then runs the hooks, so every module the file imports has
// been evaluated by now and whatever its top level called has been counted.
// Read off the ambient bucket, which is the only one that exists at this point.
const loaded = new Map<ModuleId, Uint32Array>();
beforeAll(() => {
  for (const [id, counters] of collector.ambient) loaded.set(id, counters.slice());
});

if (collector.cases !== undefined) openCaseScopes();

afterAll(() => {
  const runDirectory = process.env['VARIANCE_AUTHORITY_TEST_SELECTION_RUN'];
  if (runDirectory === undefined) {
    throw new Error(
      'variance-authority has no run directory: the reporter withTestSelection adds must be configured too',
    );
  }
  const testFile = expect.getState().testPath;
  if (testFile === undefined) throw new Error('variance-authority could not identify the current Jest file');

  const stamp = `${process.pid}-${crypto.randomUUID()}`;
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(
    `${runDirectory}/${stamp}.va`,
    journals.encodeJournal(testFile, collector.modules, loaded),
  );

  const outlived = collector.runaways();
  if (outlived.length > 0) {
    console.warn(
      `variance-authority: work outlived its case in ${testFile}:\n  ${outlived.join('\n  ')}\n` +
        'Each of these made a crossing after it had settled. The record is right — the ' +
        'crossing went to the case that made it — but the case is not over when the runner ' +
        'says it is, which is what a flaky neighbour is made of.',
    );
  }

  const caseDirectory = process.env['VARIANCE_AUTHORITY_TEST_SELECTION_CASES'];
  if (collector.cases === undefined || caseDirectory === undefined) return;
  // One file per test file rather than per case: a case per file is a file per
  // case per worker — hundreds of thousands of them on the suite this is sized
  // for. The ambient bucket writes itself under the bare file path, which is
  // what `unpackCase` reads back as *the bucket no case owns*.
  const frames: Uint8Array[] = [];
  for (const [key, held] of collector.cases) {
    if (held.size === 0) continue;
    frames.push(journals.encodeJournal(key === '' ? journals.packCase(testFile, '', '') : key, held));
  }
  if (frames.length === 0) return;
  fs.mkdirSync(caseDirectory, { recursive: true });
  fs.writeFileSync(`${caseDirectory}/${stamp}.vac`, journals.packFrames(frames));
});

/**
 * Register every case enclosed in a scope of its own.
 *
 * Only the injected globals are wrapped. A project that runs with
 * `injectGlobals: false` imports `test` from `@jest/globals` directly, and the
 * binding it destructured is not one anything here can reach; that file records
 * as one ambient bucket, which is the file-level answer it already had.
 */
function openCaseScopes(): void {
  const realm = globalThis as Record<string, unknown>;
  let ordinal = 0;
  const nextId = (): string => String(ordinal++);

  for (const name of ['test', 'it', 'fit', 'xit', 'xtest']) {
    const base = realm[name];
    if (typeof base === 'function') realm[name] = enclosing(base as Declarer, nextId);
  }
}

type Declarer = ((...args: unknown[]) => unknown) & Record<string, unknown>;

/** The same declarer, handing the runner a body that opens its case's scope. */
function enclosing(base: Declarer, nextId: () => string): Declarer {
  const wrapped = ((...args: unknown[]): unknown => {
    const [declared, body, ...rest] = args;
    if (typeof body !== 'function') return base(...args);
    return base(declared, enclosed(body as CaseBody, declared, nextId), ...rest);
  }) as Declarer;

  for (const key of Object.keys(base)) {
    const member = base[key];
    if (typeof member !== 'function') continue;
    // `each` answers with the declarer rather than being one, so it is the
    // result that has to be wrapped and not the call. Everything else —
    // `only`, `skip`, `concurrent`, `failing`, `todo` — declares directly.
    wrapped[key] = key === 'each'
      ? (...args: unknown[]): unknown =>
        enclosing((member as Declarer).apply(base, args) as Declarer, nextId)
      : enclosing(member as Declarer, nextId);
  }
  return wrapped;
}

type CaseBody = (this: unknown, ...args: unknown[]) => unknown;

/**
 * One case's body, run inside the scope its crossings belong to.
 *
 * The name is the one the runner resolved — `describe > case`, with whatever a
 * table substituted into it — because that is the coordinate a reader
 * recognises a case by, and the declared name is kept as the fallback for the
 * one case that cannot be asked: `test.concurrent` starts its body outside the
 * runner's own bracket, so the state it would read there is somebody else's.
 * The id beside it is positional and exists only to tell two cases of one name
 * apart.
 *
 * The arity is restored because Jest reads it: a body declared with `done` and
 * handed over with none is a callback test the runner would never call back.
 */
function enclosed(body: CaseBody, declared: unknown, nextId: () => string): CaseBody {
  const run = function (this: unknown, ...args: unknown[]): unknown {
    const scope = (globalThis as { [key: symbol]: { enter: <R>(key: string, body: () => R) => R } | undefined })[
      Symbol.for('variance-authority.test-selection.cases')
    ];
    if (scope === undefined) return body.apply(this, args);
    const { currentTestName: running, testPath } = expect.getState();
    const name = typeof declared === 'string' && typeof running === 'string' && running.endsWith(declared)
      ? running
      : String(declared);
    return scope.enter(journals.packCase(testPath ?? '', name, nextId()), () => body.apply(this, args));
  };
  Object.defineProperty(run, 'length', { value: body.length, configurable: true });
  return run;
}
