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
 * scope is opened. Jest exposes no seam that *wraps* a test the way Vitest's
 * `runTask` does, so the enclosure is taken rather than asked for: jest-circus
 * hands every case to its event handlers before it calls the body, and the case
 * it hands over is a mutable object whose `fn` is that body. Replacing the `fn`
 * there is the enclosure an {@link AsyncLocalStorage} needs, and it is the one
 * thing `beforeEach` and `afterEach` can never be.
 *
 * It is also inversion of control, which is why it reaches placements a search
 * of the realm cannot. The runner announces the case; nothing here has to find
 * the declarer that registered it. A file that imported `it` from
 * `@jest/globals` — what `injectGlobals: false` forces, and what any file may
 * do anyway — is bracketed by the same handler as a file using the injected
 * one, because both arrive as the same object in the same event.
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
// The ambient bucket is the only one that exists at this point, and where cases
// are recorded it is closed here as a record of its own rather than copied.
let loaded: ReadonlyMap<ModuleId, Uint32Array> = new Map();
beforeAll(() => {
  const testFile = expect.getState().testPath;
  if (testFile === undefined) throw new Error('variance-authority could not identify the current Jest file');
  loaded = collector.seal(testFile);
});

if (collector.scoped) openCaseScopes();

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
  const { modules, frames } = collector.finish(testFile);
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(`${runDirectory}/${stamp}.va`, journals.encodeJournal(testFile, modules, loaded));

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
  // One file per test file rather than per case: a case per file is a file per
  // case per worker — hundreds of thousands of them on the suite this is sized
  // for. The ambient buckets write themselves under the bare file path, which
  // is what `unpackCase` reads back as *the bucket no case owns*.
  if (frames === undefined || caseDirectory === undefined || frames.length === 0) return;
  fs.mkdirSync(caseDirectory, { recursive: true });
  fs.writeFileSync(`${caseDirectory}/${stamp}.vac`, journals.packFrames(frames));
});

/**
 * Open a scope of its own around every case, by both routes at once.
 *
 * The runner's own event is the one that reaches everything, and the declarer
 * wrapping stays behind it for a host that is not jest-circus. They compose
 * because each refuses a body the other already enclosed: a declared body is
 * marked as it is wrapped, and the handler leaves a marked one alone. Running
 * both is not redundancy for its own sake — the handler is the only route to a
 * case whose registrar was imported, and the declarers are the only route left
 * if the event never arrives.
 */
function openCaseScopes(): void {
  let ordinal = 0;
  const nextId = (): string => String(ordinal++);

  bracketEveryCase(nextId);

  const realm = globalThis as Record<string, unknown>;
  for (const name of ['test', 'it', 'fit', 'xit', 'xtest']) {
    const base = realm[name];
    if (typeof base === 'function') realm[name] = enclosing(base as Declarer, nextId);
  }
}

/** A case whose body is already enclosed, so the second route leaves it alone. */
const bracketed = new WeakSet<CaseBody>();

/** What jest-circus hands a handler: the case, with the body about to be called. */
interface CircusEvent {
  readonly name: string;
  readonly test?: { fn?: unknown; name?: unknown } | undefined;
}

/**
 * Take the enclosure from the runner rather than from the realm.
 *
 * `test_fn_start` is dispatched by `_callCircusTest` immediately before it
 * reads `test.fn`, so the body assigned here is the body that runs. Later than
 * `test_start` on purpose: a case the runner decided to skip never reaches this
 * event, and a case with no scope is one fewer empty bucket to drop afterwards.
 * A retry re-runs the same case object, whose `fn` is the enclosure from the
 * first attempt; it is left as it is and the attempt takes a fresh ordinal, the
 * same as it did when the declarer was the only route.
 *
 * Doing nothing silently is the failure mode, so the caller does not rely on
 * this alone: the declarer wrapping it installs next covers the injected
 * globals whether the event arrives or not. A host with neither reaches the
 * scope directly — `CASE_SCOPE` and `packCase` are exported from
 * `@variance-authority/sense/test-selection` for it — but no host Jest ships is
 * one of those.
 */
function bracketEveryCase(nextId: () => string): void {
  let circus: { addEventHandler?: unknown };
  try {
    // Resolved at run time, from the sandbox: jest-circus is the runner Jest
    // has defaulted to since 27, but it is the project's to replace, and a
    // project that replaced it must still get everything else in this file.
    circus = require('jest-circus') as { addEventHandler?: unknown };
  } catch {
    return;
  }
  const register = circus.addEventHandler;
  if (typeof register !== 'function') return;

  (register as (handler: (event: CircusEvent) => void) => void)((event: CircusEvent): void => {
    if (event.name !== 'test_fn_start') return;
    const held = event.test;
    if (held === undefined) return;
    const body = held.fn;
    if (typeof body !== 'function' || bracketed.has(body as CaseBody)) return;
    held.fn = scopeCase(body as CaseBody, held.name, nextId);
  });
}

type Declarer = ((...args: unknown[]) => unknown) & Record<string, unknown>;

/** The same declarer, handing the runner a body that opens its case's scope. */
function enclosing(base: Declarer, nextId: () => string): Declarer {
  const wrapped = ((...args: unknown[]): unknown => {
    const [declared, body, ...rest] = args;
    if (typeof body !== 'function') return base(...args);
    return base(declared, scopeCase(body as CaseBody, declared, nextId), ...rest);
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

// `test.each` registers a generated case body around the body it was handed.
// The circus route encloses that generated body and the declarer route has
// already enclosed the body inside it, so executing one case enters both
// wrappers synchronously. The outer, runner-named enclosure owns the case; a
// wrapper reached inside it is the same case, not concurrency.
let enclosingCase = 0;

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
function scopeCase(body: CaseBody, declared: unknown, nextId: () => string): CaseBody {
  const run = function (this: unknown, ...args: unknown[]): unknown {
    const scope = (globalThis as { [key: symbol]: { enter: <R>(key: string, body: () => R) => R } | undefined })[
      Symbol.for('variance-authority.test-selection.cases')
    ];
    if (scope === undefined) return body.apply(this, args);
    if (enclosingCase > 0) return body.apply(this, args);
    const { currentTestName: running, testPath } = expect.getState();
    const name = typeof declared === 'string' && typeof running === 'string' && running.endsWith(declared)
      ? running
      : String(declared);
    enclosingCase += 1;
    try {
      return scope.enter(journals.packCase(testPath ?? '', name, nextId()), () => body.apply(this, args));
    } finally {
      enclosingCase -= 1;
    }
  };
  Object.defineProperty(run, 'length', { value: body.length, configurable: true });
  bracketed.add(run);
  return run;
}
