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
import { scopeGlobalsSource } from './precondition-source.js';
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
  /** Where each case's story goes, when the run asked for stories. */
  readonly story?: string | undefined;
  /** The checkout the record names files against; given, the case scope keeps Eyes journals. */
  readonly root?: string;
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
  }, ${
    shim.story === undefined
      ? 'undefined'
      : `createRequire(${JSON.stringify(HERE)})('../story/format.cjs').storyWriter(${JSON.stringify(shim.story)})`
  }, ${shim.root === undefined ? 'undefined' : JSON.stringify(shim.root)});
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
      'variance-authority: async work still running after its case finished in ' + testFile +
      ' (recorded against the case that started it):\\n  ' + outlived.join('\\n  '),
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
 * The module also installs the realm's probe root, because it is the first
 * module of the configuration's a worker evaluates. Vitest imports the runner,
 * then the `snapshotSerializers` and `diff` files, and only then a test file's
 * `setupFiles` — the same order on 2, 3 and 4. A serializer that imports product
 * source runs its probes before the setup module exists, and with no root there
 * the first of them is a `TypeError` that fails every file. Installed here,
 * those probes write into a bucket the setup module's collector takes as its
 * file's ambient one, so the file is recorded as having loaded what its worker
 * evaluated for it, as it is for a setup file's imports; a case that prints
 * through the serializer is credited with what it called.
 *
 * @param runner How this module should spell `@vitest/runner`, and its `utils`
 * entry. The runner is a file in the project root, and `@vitest/runner` is a
 * dependency of Vitest rather than of the project — under a node_modules layout
 * that does not hoist, a bare specifier there resolves to nothing and every
 * test file fails to load. The caller resolves it; see `runnerImport` in
 * [`vitest.ts`](./vitest.ts). `recording` is the engine the setup module's
 * collector will ask for, which a realm decides once: the same `continuations`
 * and story answers the caller hands {@link setupSource}.
 */
export function caseRunnerSource(
  runner: {
    readonly module?: string;
    readonly utils?: string;
    readonly finished?: string;
    readonly cut?: string;
    readonly recording?: { readonly continuations: boolean; readonly story: boolean };
  } = {},
): string {
  const recording = runner.recording === undefined
    ? ''
    : `createRequire(${JSON.stringify(HERE)})('./collectors.cjs').preload(globalThis, ${
      runner.recording.continuations
    }, ${runner.recording.story});\n`;
  return `
import * as vitest from 'vitest';
import { getFn, getHooks } from ${JSON.stringify(runner.module ?? '@vitest/runner')};
import { getNames } from ${JSON.stringify(runner.utils ?? '@vitest/runner/utils')};
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// The class this runner extends. Vitest 4.1 exports it from the package root as
// \`TestRunner\` and deprecates \`vitest/runners\`, which prints a line saying so
// in every worker that imports it; the root's \`VitestTestRunner\` there is a
// type and nothing at run time. Vitest 2, 3 and 4.0 export the class only from
// \`vitest/runners\`, so that entry is imported only where the root has none.
// The root is read as a namespace because a named import it lacks fails to
// link.
const VitestTestRunner = vitest.TestRunner ?? (await import('vitest/runners')).VitestTestRunner;

${recording}
// The runner's own tree, cut to what the fold reads a file's outcome from. The
// reporter is handed the same tree, and a command-line \`--reporter\` replaces
// the reporter: an editor that runs one test from the gutter passes its own.
// The mode is in the cut because a test the runner never started, a todo or a
// skip, has no result on Vitest 2, and its mode is the only outcome it has.
// Beside it, whether this runner wrote skips of its own: a name filter, in the
// configuration the worker collected under, and a cancel, which rewrites the
// tests it had not reached in this worker's copy of the tree and no other.
// Every result also keeps the duration the runner measured, and every task its
// name and id, which is what joins a case's duration to the case the scope
// recorded under the same id; nothing here reads a clock.
const finished = ${JSON.stringify(runner.finished ?? null)};
const tree = (task) => ({
  ...(task.name === undefined ? {} : { name: task.name }),
  ...(task.id === undefined ? {} : { id: task.id }),
  ...(task.mode === undefined ? {} : { mode: task.mode }),
  ...(task.result === undefined ? {} : {
    result: {
      state: task.result.state,
      ...(typeof task.result.duration === 'number' ? { duration: task.result.duration } : {}),
    },
  }),
  ...(task.tasks === undefined ? {} : { tasks: task.tasks.map(tree) }),
});

const caseScope = () => globalThis[Symbol.for('variance-authority.test-selection.cases')];
// The declaration path under the file, which is what a reader recognises a
// case by. The runner's own \`test.id\` is unique and is carried beside it,
// because it is positional and moves when a case is inserted above.
const caseKey = (test) => {
  const names = getNames(test);
  const file = test.file?.filepath ?? names[0] ?? '';
  return file + '\\u0000' + names.slice(1).join(' > ') + '\\u0000' + test.id;
};

// Where a \`variancePrecondition\` call stands. Hooks are wrapped when their
// suite starts, each knowing its depth and, for a \`beforeEach\`, the case it
// runs for. A \`beforeAll\` or an \`afterAll\` runs for no one case, and a call
// in one throws, as a call while the file collects does.
const WRAPPED = Symbol('variance-authority.wrapped-hook');
const hookAt = (kind, depth, args) => {
  if (kind === 'afterEach') return { kind: 'after' };
  if (kind !== 'beforeEach') {
    return { kind: 'outside', because: 'ran in ' + (kind === 'beforeAll' ? 'a beforeAll' : 'an afterAll') + ', which runs for no one case' };
  }
  const test = args[0]?.task;
  return test === undefined
    ? { kind: 'outside', because: 'ran in a beforeEach Vitest named no case for' }
    : { kind: 'each', depth, case: caseKey(test) };
};

// The cases the selection skips, by the absolute path of their file, as the
// sequencer wrote them before any worker started. Read at each file's
// collection rather than once, because a worker outlives one run under watch.
// A test it names is marked skipped, as \`it.skip\` would have; one the file
// already skips, or runs alone under \`only\`, keeps the mode it has.
const cutFile = ${JSON.stringify(runner.cut ?? null)};
const cutOf = (filepath) => {
  if (cutFile === null) return undefined;
  try {
    return JSON.parse(readFileSync(cutFile, 'utf8'))[filepath];
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
};
const skipCut = (task, names) => {
  if (task.type === 'test' && task.mode === 'run' && names.has(getNames(task).slice(1).join(' > '))) task.mode = 'skip';
  for (const child of task.tasks ?? []) skipCut(child, names);
};

export default class extends VitestTestRunner {
  async onCollected(files) {
    await super.onCollected?.(files);
    for (const file of files) {
      const names = cutOf(file.filepath);
      if (names !== undefined) skipCut(file, new Set(names));
    }
  }

  async onBeforeRunSuite(suite) {
    await super.onBeforeRunSuite?.(suite);
    const scope = caseScope();
    const hooks = scope?.within === undefined ? undefined : getHooks(suite);
    if (hooks === undefined) return;
    const depth = getNames(suite).length - 1;
    for (const kind of ['beforeAll', 'beforeEach', 'afterEach', 'afterAll']) {
      const registered = hooks[kind] ?? [];
      const kept = [];
      for (const hook of registered) {
        if (hook[WRAPPED] === true) {
          kept.push(hook);
          continue;
        }
        kept.push(Object.assign(function (...args) {
          return scope.within(hookAt(kind, depth, args), () => hook.apply(this, args));
        }, { [WRAPPED]: true }));
      }
      registered.splice(0, registered.length, ...kept);
    }
  }

  async onAfterRunFiles(files) {
    await super.onAfterRunFiles?.(files);
    if (finished === null) return;
    await mkdir(finished, { recursive: true });
    const runnerSkipped = Boolean(this.config?.testNamePattern) || this.cancelRun === true;
    await writeFile(
      finished + '/' + process.pid + '-' + randomUUID() + '.json',
      JSON.stringify(files.map((file) => ({ filepath: file.filepath, runnerSkipped, ...tree(file) }))),
    );
  }

  // An attempt is its hooks as well as its body, and Eyes hands a journal over
  // in \`afterEach\`: the scope attends the case from here until the test's
  // \`onFinished\` callbacks, which run once its \`afterEach\` hooks are done.
  async onBeforeTryTask(test, options) {
    await super.onBeforeTryTask?.(test, options);
    const scope = globalThis[Symbol.for('variance-authority.test-selection.cases')];
    if (typeof scope?.begin !== 'function') return;
    scope.begin();
    (test.onFinished ??= []).push(() => scope.leave());
  }

  runTask(test) {
    const fn = getFn(test);
    if (!fn) throw new Error('variance-authority: Vitest gave a task with no function');
    const scope = globalThis[Symbol.for('variance-authority.test-selection.cases')];
    if (scope === undefined) return fn();
    return scope.enter(caseKey(test), fn);
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
    // The body is second, or third behind an options object.
    const at = typeof args[1] === 'function' ? 1 : typeof args[2] === 'function' ? 2 : -1;
    if (at !== -1) {
      const fn = args[at];
      const ordinal = String((caseOrdinal += 1));
      // The describe path it was registered under, from the describe wrap below.
      const path = scopeCurrent;
      args[at] = function (...given) {
        const state = expect.getState();
        // Concurrent cases share the one \`expect\`, which names whichever case
        // set it last; the case's own context names the case, under the path
        // it was registered at.
        const own = given[0]?.task?.name;
        const name = typeof own !== 'string' || state.currentTestName === own ||
          state.currentTestName?.endsWith(' > ' + own) === true
          ? state.currentTestName ?? ''
          : [...path, own].join(' > ');
        const key = (state.testPath ?? '') + '\\u0000' + name + '\\u0000' + ordinal;
        // The context the runner hands the body is the one it handed the
        // case's \`beforeEach\`es, so it joins what they said to this case
        // when cases run concurrently.
        return caseScope.enter(key, () => fn.apply(this, given), given[0]);
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
${scopeGlobalsSource(holders)}`;
}

/**
 * The attending bracket for a runner that has no runner to replace, as source:
 * the counterpart of `onBeforeTryTask` in {@link caseRunnerSource}.
 *
 * Rstest calls the root's `beforeEach` hooks at the start of every attempt,
 * retries included, and the setup module registers this one before any of the
 * project's, so a journal opened in the project's `beforeEach` is already
 * attended. The attempt's `onTestFinished` callbacks run once its `afterEach`
 * hooks are done, which is where the bracket closes.
 *
 * @param api Source for the object that holds `beforeEach`.
 */
export function attendingSource(api: string): string {
  return `
{
  const attended = globalThis[Symbol.for(${JSON.stringify(CASE_SCOPE_KEY)})];
  if (typeof attended?.begin === 'function') {
    ${api}.beforeEach((context) => {
      attended.begin();
      context.onTestFinished(() => attended.leave());
    });
  }
}
`;
}
