/**
 * Every module this seam generates, as text.
 *
 * Three modules are written rather than imported — the setup file each worker
 * evaluates, the runner that opens a case scope, and the collectors inside them
 * — because each has to arrive somewhere an import cannot reach it: a Vite
 * virtual id, a sandbox with no transform, a worker with no resolution root.
 * They are gathered here so that what crosses that boundary is one file to read,
 * and so neither half that consumes them has to carry the other's text.
 *
 * Nothing here runs in this process. A mistake in this file is a mistake in a
 * string, which is why `cases.concurrency.test.ts` evaluates the collector in a
 * child realm rather than trusting that it reads correctly.
 */

import { AMBIENT, CASE_SCOPE } from './cases.js';

/** The realm key {@link CASE_SCOPE} is, as the generated source has to spell it. */
const CASE_SCOPE_KEY = Symbol.keyFor(CASE_SCOPE) ?? '';

/**
 * This file, so the setup module can reach the codec beside it.
 *
 * The setup module is loaded by id through this plugin and has no directory of
 * its own to resolve a package name from, which leaves an absolute reference —
 * and it is taken with `createRequire` rather than an `import` because Vite
 * resolves every specifier a module it transforms names. A file under jsdom is
 * transformed in web mode, where an absolute `file:` URL is not a specifier
 * anything resolves, and the codec is CommonJS that has no business going
 * through a transform in either mode. `node:module` is a builtin, so the one
 * import the setup module keeps is one every runner already externalizes.
 */
const HERE = import.meta.url;

/**
 * The module every test file evaluates before itself: the counter factory, and
 * the handoff at the end.
 *
 * The counters go out as a frame through the same codec the Jest half uses, so
 * neither runner's journals are a shape the other does not read, and neither
 * worker builds a row per module to hand one over.
 */
export interface SetupShim {
  /**
   * The specifier the runner's hooks are imported from. `vitest` when absent.
   *
   * `beforeAll`, `afterAll` and `expect` are the whole of what this module asks
   * a runner for, and Rstest spells all three the same way Vitest does — so the
   * one thing that differs between the two shims is the name above them.
   */
  readonly runner?: string;
  /**
   * Source that opens a case scope around each test, for a runner that cannot be
   * given a runner of its own. Evaluated after the collector is installed and
   * before the first hook is registered.
   */
  readonly scope?: string;
}

export function setupSource(
  runDirectory: string,
  caseDirectory?: string,
  shim: SetupShim = {},
): string {
  // One counter set for the whole file, which is what the file-level snapshot
  // asks for and all it asks for.
  const flat = `
const modules = new Map();
// A module \`vi.resetModules\` evaluates again resolves this again, and keeps
// what it counted before the reset: same name and block count, same counters.
globalThis.__VA__ = (id, count) => {
  let counters = modules.get(id);
  if (counters === undefined || counters.length !== count) {
    counters = new Uint32Array(count);
    modules.set(id, counters);
  }
  return counters;
};
// Nothing here is scoped, and the probe still asks. Every collector declares
// \`s\`, empty spelled \`undefined\`, so that load reads one shape whichever
// collector the realm installed.
globalThis.__VA__.s = undefined;
const ambient = () => modules;
const fileModules = () => modules;
`;

  // One counter set per case, keyed by async context, plus the ambient bucket
  // for everything no case owns. The file-level snapshot is their union, which
  // is bit-for-bit what the flat collector above would have counted.
  const scoped = caseCollectorSource();

  const writeCases = caseDirectory === undefined ? '' : caseWriterSource(caseDirectory);

  return `
import { afterAll, beforeAll, expect } from ${JSON.stringify(shim.runner ?? 'vitest')};
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const journalFormat = createRequire(${JSON.stringify(HERE)})('./journal-format.cjs');
${caseDirectory === undefined ? flat : scoped}
${caseDirectory === undefined ? '' : (shim.scope ?? '')}
// What had run before the file's first test. The file is collected — its
// imports evaluated, its top level run — before any hook runs, so a function
// counted here ran as a consequence of loading, not of a test. Read off the
// ambient bucket, which is the only one that exists at this point: no case has
// opened a scope yet.
const loaded = new Map();
beforeAll(() => {
  for (const [id, counters] of ambient()) loaded.set(id, counters.slice());
});
afterAll(async () => {
  const testFile = expect.getState().testPath;
  if (!testFile) throw new Error('variance-authority could not identify the current Vitest file');
  const stamp = process.pid + '-' + randomUUID();
  await mkdir(${JSON.stringify(runDirectory)}, { recursive: true });
  await writeFile(
    ${JSON.stringify(`${runDirectory}/`)} + stamp + '.va',
    journalFormat.encodeJournal(testFile, fileModules(), loaded),
  );
${writeCases}});`;
}

/**
 * The page-and-worker half, as source, because it has to cross a bundler.
 *
 * `node:async_hooks` is a builtin, which every runner externalizes — the same
 * reason the generated setup module may already import `node:fs/promises` while
 * running under jsdom.
 *
 * The ambient factory is minted eagerly so that a module evaluated before any
 * case exists finds one, and so `__vaE` — which re-resolves the factory to
 * lower the evaluating depth — finds the same object its `__va(0)` raised it on.
 *
 * `__VA__` is a data property holding that ambient factory, and the scope is
 * read through its `s` rather than through an accessor on the realm. The
 * accessor is the shape this started as and it costs six nanoseconds a hit for
 * nothing — [`instrument`](../instrument/index.ts) has the reading and the
 * reason.
 */
export function caseCollectorSource(): string {
  return `
import { AsyncLocalStorage } from 'node:async_hooks';
const scopes = new AsyncLocalStorage();
const buckets = new Map();
const factories = new Map();
const factoryFor = (key) => {
  let factory = factories.get(key);
  if (factory !== undefined) return factory;
  const held = new Map();
  buckets.set(key, held);
  factory = (id, count) => {
    let counters = held.get(id);
    if (counters === undefined || counters.length !== count) {
      counters = new Uint32Array(count);
      held.set(id, counters);
    }
    return counters;
  };
  factory.s = resolve;
  factories.set(key, factory);
  return factory;
};
const ambientFactory = factoryFor(${JSON.stringify(AMBIENT)});
// The store holds the factory itself rather than the key it was minted under:
// the probe asks on every hit, and a \`Map.get\` on a case coordinate is most of
// what asking costs once the accessor is gone.
function resolve() { return scopes.getStore() ?? ambientFactory; }
globalThis.__VA__ = ambientFactory;
globalThis[Symbol.for('variance-authority.test-selection.cases')] = {
  enter: (key, body) => scopes.run(factoryFor(key), body),
};
const ambient = () => buckets.get(${JSON.stringify(AMBIENT)});
// Presence, not arithmetic: every reader of these arrays asks only whether a
// counter is above zero and whether it carries the evaluating bit, so the union
// of what the cases and the ambient bucket entered is a bitwise or. Summing
// would overflow the bit that answers the second question.
const fileModules = () => {
  const union = new Map();
  for (const held of buckets.values()) {
    for (const [id, counters] of held) {
      const into = union.get(id);
      if (into === undefined || into.length !== counters.length) {
        union.set(id, counters.slice());
        continue;
      }
      for (let at = 0; at < counters.length; at += 1) into[at] |= counters[at];
    }
  }
  return union;
};
${PACK_FRAMES_SOURCE}`;
}

/** {@link packFrames}, as source, for the worker that has no import of it. */
const PACK_FRAMES_SOURCE = `
const packFrames = (frames) => {
  let total = 0;
  for (const frame of frames) total += frame.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const frame of frames) {
    view.setUint32(at, frame.length, true);
    out.set(frame, at + 4);
    at += frame.length + 4;
  }
  return out;
};
`;

/**
 * The tail of the setup module's `afterAll`: every bucket out as its own frame.
 *
 * One file per test file rather than per case, because a case per file is a file
 * per case per worker — hundreds of thousands of them on the suite this is sized
 * for. The ambient bucket writes itself under the bare file path, which is what
 * {@link unpackCase} reads back as *the bucket no case owns*.
 */
export function caseWriterSource(caseDirectory: string): string {
  return `
  const frames = [];
  for (const [key, held] of buckets) {
    if (held.size === 0) continue;
    frames.push(journalFormat.encodeJournal(
      key === '' ? testFile + '\u0000\u0000' : key,
      held,
    ));
  }
  if (frames.length > 0) {
    await mkdir(${JSON.stringify(caseDirectory)}, { recursive: true });
    await writeFile(${JSON.stringify(caseDirectory + '/')} + stamp + '.vac', packFrames(frames));
  }
`;
}

/**
 * The runner half, as source, because Vitest loads a runner by module id.
 *
 * `runTask` is the one seam in `@vitest/runner` that *wraps* the test function
 * rather than being called beside it, which is the whole requirement: an
 * `AsyncLocalStorage` needs an enclosing call, and `onBeforeRunTask` and
 * `afterEach` are neighbours, not enclosures. Everything the case awaits resolves
 * inside the store, and two concurrent cases each stay in their own — which is
 * the property a hook-based drain cannot have at any price.
 *
 * `beforeEach` runs outside this, deliberately: it is called by `runTest` before
 * `runTask`, so nothing can wrap it from here. Its crossings land in the ambient
 * bucket and reach every case in the file.
 */
export function caseRunnerSource(): string {
  return `
// \`vitest/runners\` on every supported major. Vitest 4.1 deprecates the entry in
// favour of the package root and prints a line saying so on each run, but does
// not export the class there yet — measured on 4.1.11, where the root has no
// \`VitestTestRunner\` at all. The notice is the cost of the only entry that
// answers on 2, 3 and 4 alike.
import { VitestTestRunner } from 'vitest/runners';
import { getFn } from '@vitest/runner';
import { getNames } from '@vitest/runner/utils';

export default class extends VitestTestRunner {
  runTask(test) {
    const fn = getFn(test);
    if (!fn) throw new Error('variance-authority: Vitest gave a task with no function');
    const scope = globalThis[Symbol.for('variance-authority.test-selection.cases')];
    if (scope === undefined) return fn();
    const names = getNames(test);
    const file = test.file?.filepath ?? names[0] ?? '';
    // The declaration path under the file, which is what a reader recognises a
    // case by. The runner's own \`test.id\` is unique and is carried beside it,
    // because it is positional and moves when a case is inserted above.
    return scope.enter(
      file + '\\u0000' + names.slice(1).join(' > ') + '\\u0000' + test.id,
      fn,
    );
  }
}
`;
}

/**
 * The case scope for a runner that has no runner to replace, as source.
 *
 * Vitest loads a runner by module id, and `runTask` there *wraps* the test
 * function — see {@link caseRunnerSource}. Rstest has no such option, so the
 * enclosure has to come from the only other thing that holds the function
 * before the runner calls it: the API that registered it. Every registrar is
 * wrapped, its own properties with it, because `it.only`, `it.concurrent` and
 * `it.each(rows)` are each a separate callable that takes a test function and
 * none of them route through the bare one.
 *
 * The coordinate is read at call time rather than at registration: `each`
 * interpolates its row into the title, and a describe path is only assembled
 * once the suite has collected. `currentTestName` is the resolved answer to
 * both, spelled exactly as a reader recognises the case by.
 *
 * The wrap is applied to every object that *holds* a registrar, which is what
 * `holders` names. `globals: true` puts them on the realm; an import does not,
 * but under Rspack `@rstest/core` is an external of type `global`, so
 * `import { it } from '@rstest/core'` compiles to a property read of
 * `globalThis['@rstest/core']` — the object the runner assigns the API to
 * before any setup file runs. Wrapping that object's `it` and `test` in place
 * reaches the imported registrars for the same reason wrapping the realm
 * reaches the injected ones, and neither spelling has to be configured.
 *
 * @param holders Source for the objects to wrap the registrars on, in the
 * order they are wrapped. Defaults to the realm alone, which is every runner
 * whose API is a module rather than an injected object.
 */
export function caseGlobalsSource(holders = 'globalThis'): string {
  return `
const caseScope = globalThis[Symbol.for(${JSON.stringify(CASE_SCOPE_KEY)})];
let caseOrdinal = 0;
// A registrar's properties are registrars too, and \`each\` answers with one
// rather than taking the function itself. Both are followed, to the depth the
// deepest of them nests — \`it.only.each(rows)(name, fn)\`.
const wrapCase = (api, depth) => {
  if (typeof api !== 'function' || depth > 4) return api;
  const out = function (...args) {
    const fn = args[1];
    if (typeof fn === 'function') {
      const ordinal = String((caseOrdinal += 1));
      args[1] = function (...given) {
        const state = expect.getState();
        const key = (state.testPath ?? '') + '\\u0000' + (state.currentTestName ?? '') + '\\u0000' + ordinal;
        return caseScope.enter(key, () => fn.apply(this, given));
      };
    }
    const answered = api.apply(this, args);
    return typeof answered === 'function' ? wrapCase(answered, depth + 1) : answered;
  };
  for (const key of Object.keys(api)) out[key] = wrapCase(api[key], depth + 1);
  return out;
};
for (const holder of [${holders}]) {
  if (holder === undefined || holder === null) continue;
  for (const name of ['it', 'test']) {
    if (typeof holder[name] === 'function') holder[name] = wrapCase(holder[name], 0);
  }
}
`;
}
