/**
 * Every module this seam generates, as text.
 *
 * Two modules are written rather than imported — the setup file each worker
 * evaluates, and the runner that opens a case scope — because each has to
 * arrive somewhere an import cannot reach it: a Vite virtual id, a worker with
 * no resolution root. They are gathered here so that what crosses that
 * boundary is one file to read, and so neither half that consumes them has to
 * carry the other's text.
 *
 * The collectors are not text. The setup module requires `collectors.cjs`,
 * which is the file Jest's setup runs, so the two runners share one
 * implementation rather than a copy each.
 */

import { CASE_SCOPE } from './cases.js';
import { EXECUTION_GLOBAL, executionCollectorSource } from './probes.js';
import type { InstrumentMode } from '../instrument/index.js';

/** The realm key {@link CASE_SCOPE} is, as the generated source has to spell it. */
const CASE_SCOPE_KEY = Symbol.keyFor(CASE_SCOPE) ?? '';

/**
 * This file, so the setup module can reach the collectors and the codec beside
 * it.
 *
 * The setup module is loaded by id through this plugin and has no directory of
 * its own to resolve a package name from, which leaves an absolute reference —
 * and it is taken with `createRequire` rather than an `import` because Vite
 * resolves every specifier a module it transforms names. A file under jsdom is
 * transformed in web mode, where an absolute `file:` URL is not a specifier
 * anything resolves, and the codec is CommonJS that has no business going
 * through a transform in either mode; so are the collectors. `node:module` is a builtin, so the one
 * import the setup module keeps is one every runner already externalizes.
 */
const HERE = import.meta.url;

/**
 * The module every test file evaluates before itself: the collector, and the
 * handoff at the end.
 *
 * What it entered goes out as a frame through the same codec the Jest half uses, so
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
  /**
   * Follow each case's continuations through the async context, and name the
   * cases whose work outlived them.
   *
   * Off, the case running now is a variable, and a second case opening while one
   * is still open records the file whole. `collectors.cts` has both modes, and `cases.ts`
   * what each costs.
   */
  readonly continuations?: boolean;
}

export function setupSource(
  runDirectory: string,
  caseDirectory: string,
  shim: SetupShim = {},
): string {
  return `
import { afterAll, beforeAll, expect } from ${JSON.stringify(shim.runner ?? 'vitest')};
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const journalFormat = createRequire(${JSON.stringify(HERE)})('./journal-format.cjs');
const collector = createRequire(${JSON.stringify(HERE)})('./collectors.cjs').scoped(globalThis, ${
    shim.continuations === true
  });
const seal = (testFile) => collector.seal(testFile);
const finish = (testFile) => collector.finish(testFile);
const runaways = () => collector.runaways();
${shim.scope ?? ''}
// What had run before the file's first test. The file is collected — its
// imports evaluated, its top level run — before any hook runs, so a function
// counted here ran as a consequence of loading, not of a test. Read off the
// ambient bucket, which is the only one that exists at this point: no case has
// opened a scope yet. It is closed as a record of its own rather than copied.
const testPath = () => {
  const testFile = expect.getState().testPath;
  if (!testFile) throw new Error('variance-authority could not identify the current Vitest file');
  return testFile;
};
let loaded = new Map();
beforeAll(() => { loaded = seal(testPath()); });
afterAll(async () => {
  const testFile = testPath();
  const stamp = process.pid + '-' + randomUUID();
  const { modules, frames } = finish(testFile);
  await mkdir(${JSON.stringify(runDirectory)}, { recursive: true });
  await writeFile(
    ${JSON.stringify(`${runDirectory}/`)} + stamp + '.va',
    journalFormat.encodeJournal(testFile, modules, loaded),
  );
  const outlived = runaways();
  if (outlived.length > 0) {
    console.warn(
      'variance-authority: work outlived its case in ' + testFile + ':\\n  ' +
      outlived.join('\\n  ') +
      '\\nEach of these made a crossing after it had settled. The record is right — ' +
      'the crossing went to the case that made it — but the case is not over when ' +
      'the runner says it is, which is what a flaky neighbour is made of.',
    );
  }
${caseWriterSource(caseDirectory)}});`;
}

/**
 * The key a page puts its file's journal under, on the file task's `meta`.
 *
 * Named for the package rather than for the job, because `meta` is one
 * namespace shared with the project's own tests and every other reporter's.
 */
export const BROWSER_JOURNAL = 'varianceAuthority';

/**
 * The setup module for a test file that runs in a page: the page collector, and
 * the handoff through the runner at the end.
 *
 * A page has no disk and no builtins, so the frame {@link setupSource} writes
 * has nowhere to go. What does reach the Vitest process is the file task
 * itself: the runner sends its `meta` with the file's result once `afterAll`
 * has run, which is the one channel the page and the reporter already share.
 * The two drains are what {@link setupSource} reads as `loaded` and `modules`:
 * everything before the first test, then everything after it.
 *
 * The collector is the one a built preview carries, so a module a page ran is
 * counted by the code every other page counts with. It is evaluated in a block,
 * where a bundle's module scope would put it, and a realm that already has a
 * collector keeps it: the drain is always the realm's own.
 */
export function browserSetupSource(mode?: InstrumentMode, runner = 'vitest'): string {
  return `
import { afterAll, beforeAll } from ${JSON.stringify(runner)};
{${executionCollectorSource(mode)}}
const execution = globalThis[${JSON.stringify(EXECUTION_GLOBAL)}];
let loaded = [];
beforeAll(() => { loaded = execution.drain().modules; });
// Vitest hands the hook the file task, first through Vitest 4 and second from
// 5, where the first is a fixture context and a parameter the hook names has
// to destructure it. So the hook names none. Rstest hands it the file's
// context, whose \`meta\` it reports with the file's result.
afterAll(function () {
  const file = [...arguments].find((task) =>
    typeof task?.filepath === 'string' && (task.type === 'suite' || typeof task.meta === 'object'));
  if (file === undefined) return;
  (file.meta ??= {})[${JSON.stringify(BROWSER_JOURNAL)}] = { loaded, ran: execution.drain().modules };
});
`;
}

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
  if (frames !== undefined && frames.length > 0) {
    await mkdir(${JSON.stringify(caseDirectory)}, { recursive: true });
    await writeFile(${JSON.stringify(caseDirectory + '/')} + stamp + '.vac', journalFormat.packFrames(frames));
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
 *
 * @param runner How this module should spell `@vitest/runner`, and its `utils`
 * entry. The runner is a file in the project root, and `@vitest/runner` is a
 * dependency of Vitest rather than of the project — under a node_modules layout
 * that does not hoist, a bare specifier there resolves to nothing and every
 * test file fails to load. The caller resolves it; see `runnerImport` in
 * [`vitest.ts`](./vitest.ts).
 */
export function caseRunnerSource(
  runner: { readonly module?: string; readonly utils?: string } = {},
): string {
  return `
// \`vitest/runners\` on every supported major. Vitest 4.1 deprecates the entry in
// favour of the package root and prints a line saying so on each run, but does
// not export the class there yet — measured on 4.1.11, where the root has no
// \`VitestTestRunner\` at all. The notice is the cost of the only entry that
// answers on 2, 3 and 4 alike.
import { VitestTestRunner } from 'vitest/runners';
import { getFn } from ${JSON.stringify(runner.module ?? '@vitest/runner')};
import { getNames } from ${JSON.stringify(runner.utils ?? '@vitest/runner/utils')};

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
