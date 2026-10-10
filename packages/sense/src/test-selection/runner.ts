/**
 * The recording, for a runner this package has no seam for.
 *
 * A seam asks a runner for four things: somewhere to transform product source,
 * a lifecycle around each test file, a stable name for that file, and an end of
 * the run to fold at. The Vitest, Jest and Rstest seams find all four in the
 * runner's configuration. A runner this package does not know has them too —
 * it is only that nobody but its author knows where. So this module exports the
 * four as functions, and the author calls each one from the place their runner
 * already has for it:
 *
 * - {@link startRecording} in the process that starts the run, and its
 *   `finish` where that process knows which files passed;
 * - {@link registerRecording}, or {@link instrumentModule} from a transform
 *   the runner already has, wherever product source is loaded;
 * - {@link observeTestFile} around each test file, in whichever process runs it.
 *
 * Nothing here is a runner. There is no `test`, no `expect`, no discovery and no
 * scheduling, and nothing is called that the author did not call.
 *
 * The halves meet across processes the way the Jest seam's do, because a
 * runner that forks is the ordinary case: each observed file writes its
 * journal to the run directory, and the fold reads them and cuts every module
 * they name again from the checkout. What names the run is one environment
 * variable, which every child process and worker thread inherits unless the
 * runner builds their environment from nothing — and then `Recording.env` is
 * what it spreads in.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks, type ModuleHooks } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstrumentMode, ModuleId } from '../instrument/index.js';
import { captureModule, markModule } from './captured-modules.js';
import collectors from './collectors.cjs';
import journalFormat from './journal-format.cjs';
import { recordFileFor } from './record-location.js';
import { defaultInclude } from './instrumented-modules.js';
import { repositoryRoot } from './repository-root.js';
import { reportedDuration } from './finished-files.js';
import { finishedCase } from './case-durations.js';
import { foldRun } from './selection-fold.js';
import { newRun } from './selection-run.js';

/** The environment variable that names the open recording to every process of the run. */
export const RECORDING_VARIABLE = 'VARIANCE_AUTHORITY_RECORDING';

export interface RecordingOptions {
  /** Any directory inside the checkout being recorded; the current directory when absent. */
  readonly root?: string;
  /** The snapshot this run layers onto; the checkout's cache path when absent. */
  readonly coverageFile?: string;
  /**
   * The suite this run is, as the root `variance.config.json` declares it under
   * `suites`. Required once any suite is declared, and refused beside
   * `coverageFile`.
   */
  readonly suite?: string;
  /**
   * Files every test's outcome depends on that no transform sees: a config the
   * runner reads, a fixture read with `fs`. A change to one selects every test.
   */
  readonly preconditions?: readonly string[];
  /** The probe recipe; `'presence'` when absent. */
  readonly mode?: InstrumentMode;
  /** Follow each case through the async context, and name the ones whose work outlived them. */
  readonly continuations?: boolean;
}

/** A test file the run finished with, and whether its record may be trusted. */
export interface FinishedTestFile {
  /** The path the file was observed under. */
  readonly file: string;
  /**
   * Every case in the file ran to the end and passed, or was skipped. A file
   * that failed, errored or stopped early recorded only as far as it got, and
   * is kept as evidence that selects it rather than as a reach that excludes it.
   */
  readonly complete: boolean;
  /**
   * Milliseconds your runner reported the file took. Recorded as given; left
   * out, the file is recorded with no duration rather than a zero.
   */
  readonly duration?: number;
  /**
   * Every case your runner reported in the file, with the milliseconds it
   * reported for each. A case is matched by the name you passed to
   * {@link TestFileObserver.case}; one you leave out, or a name the file
   * declares twice, is recorded with no duration.
   */
  readonly cases?: readonly FinishedTestCase[];
}

/** One case your runner reported, as {@link FinishedTestFile.cases} lists it. */
export interface FinishedTestCase {
  /** The name the case was observed under: a string, or the declaration path. */
  readonly name: string | readonly string[];
  /** Milliseconds your runner reported the case took; left out, the case is untimed. */
  readonly duration?: number;
}

export interface Recording {
  /** What a child process's environment needs when the runner does not pass its own on. */
  readonly env: Readonly<Record<string, string>>;
  /** Fold every journal the run wrote into the snapshot. Called once, when the last file is done. */
  finish(files: readonly FinishedTestFile[]): Promise<void>;
}

/** What every process of the run reads from {@link RECORDING_VARIABLE}. */
interface Carried {
  readonly root: string;
  readonly runDirectory: string;
  readonly caseDirectory: string;
  readonly mode: InstrumentMode;
  readonly continuations: boolean;
}

/**
 * Open a recording, in the process that starts the run and before it starts
 * any other.
 *
 * Sets {@link RECORDING_VARIABLE} on this process, so a child forked after this
 * call records into it, and clears it again in `finish`.
 */
export function startRecording(options: RecordingOptions = {}): Recording {
  const root = repositoryRoot(resolve(options.root ?? '.'));
  const coverageFile = recordFileFor(root, process.cwd(), options);
  const mode = options.mode ?? 'presence';
  const run = newRun(coverageFile, root, mode);
  for (const file of options.preconditions ?? []) run.preconditions.add(resolve(file));
  const carried: Carried = {
    root,
    runDirectory: run.runDirectory,
    caseDirectory: run.caseDirectory,
    mode,
    continuations: options.continuations === true,
  };
  const value = JSON.stringify(carried);
  process.env[RECORDING_VARIABLE] = value;

  const fold = foldRun(run, {
    coverageFile,
    shims: [],
    derive: true,
    unreached:
      'No module reported to this run: check that registerRecording() or ' +
      'instrumentModule() runs in every process that loads product source, and that those ' +
      `processes inherit ${RECORDING_VARIABLE}.`,
  });
  return {
    env: { [RECORDING_VARIABLE]: value },
    async finish(files) {
      try {
        await fold(files.map((file) => ({
          filepath: resolve(file.file),
          complete: file.complete,
          ...reportedDuration(file.duration),
          ...(file.cases === undefined ? {} : {
            cases: file.cases.map((test) => finishedCase(
              typeof test.name === 'string' ? test.name : test.name.join(' > '),
              undefined,
              test.duration,
            )),
          }),
        })));
      } finally {
        if (process.env[RECORDING_VARIABLE] === value) delete process.env[RECORDING_VARIABLE];
      }
    },
  };
}

/** The recording this process takes part in, when one is open. */
function carried(): Carried | undefined {
  const value = process.env[RECORDING_VARIABLE];
  return value === undefined || value === '' ? undefined : (JSON.parse(value) as Carried);
}

/**
 * Put probes on one product module.
 *
 * For a runner that already transforms source — a bundler, a compile step, its
 * own loader. Call it first, on the file as it is on disk: the probes report
 * the file and the digest of `code`, and the fold cuts the file again where
 * the digest still matches. A module handed over after another transform
 * changed it is recorded as one whose reach is not known, which selects every
 * test that entered it. The probes keep every line where it was, so a later
 * transform's source map still names the right lines. Outside a recording it
 * answers `code` unchanged, because instrumented code needs a recording to run
 * in.
 *
 * Only for product source: a test file is not a module that other files run,
 * and its own edit already selects it.
 */
export function instrumentModule(code: string, file: string): string {
  const recording = carried();
  if (recording === undefined) return code;
  const path = resolve(file);
  const original = (at: string) => (at === path ? code : readFileSync(at, 'utf8'));
  // TODO: publish a marking sibling of this function on `./runner`, so a runner with its own transform marks a module it must not probe rather than probing it; a predicate cannot ride RECORDING_VARIABLE to reach this one.
  return captureModule(recording.root, path, code, () => true, recording.mode, original)?.code ?? code;
}

export interface RegisterRecordingOptions {
  /**
   * Which loaded files are product source. When absent: JavaScript and
   * TypeScript inside the checkout, less test and spec files, dependencies and
   * built output.
   */
  readonly include?: (file: string) => boolean;
  /**
   * Which loaded files are product source no probe may sit in: a module whose
   * functions cross into a page as text, where the first probe would throw. It
   * wins over `include`. Each is marked as loaded at its end instead, and an
   * edit to it selects every test that loaded it.
   */
  readonly unprobed?: (file: string) => boolean;
}

/**
 * Instrument every product module this process loads, through Node's own
 * module hooks.
 *
 * For a runner that evaluates source with `import` or `require` and has no
 * transform of its own. Call it in each process that runs tests, before that
 * process loads any product module. It covers ES modules and CommonJS alike,
 * TypeScript that Node strips itself, and whatever a loader registered before
 * it hands on — so the probes land on what Node is about to evaluate.
 *
 * Answers with Node's own handle, whose `deregister()` removes the hooks, or
 * with `undefined` outside a recording.
 */
export function registerRecording(options: RegisterRecordingOptions = {}): ModuleHooks | undefined {
  const recording = carried();
  if (recording === undefined) return undefined;
  collectors.attach(globalThis as { __VA__?: unknown }, recording.continuations);
  const include = options.include ?? ((file: string) => inside(recording.root, file) && defaultInclude(file));
  return registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!url.startsWith('file:') || loaded.source === undefined || loaded.source === null) return loaded;
      // TypeScript is instrumented as written, and Node strips its types after.
      if (!EVALUATED.has(loaded.format ?? '')) return loaded;
      const file = fileURLToPath(url);
      // The observed file is the test, and a test is not a module other files run.
      if (file === observing) return loaded;
      const marked = options.unprobed?.(file) === true;
      if (!marked && !include(file)) return loaded;
      const code = typeof loaded.source === 'string' ? loaded.source : new TextDecoder().decode(loaded.source);
      if (!marked) return { ...loaded, source: instrumentModule(code, file) };
      const original = (at: string) => (at === file ? code : readFileSync(at, 'utf8'));
      return { ...loaded, source: markModule(recording.root, file, code, () => true, original)?.code ?? code };
    },
  });
}

/** The formats Node evaluates from source text; `json`, `wasm`, `builtin` and `addon` are not. */
const EVALUATED = new Set(['module', 'commonjs', 'module-typescript', 'commonjs-typescript']);

function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path);
}

/** Everything the runner reports about one test file while it runs. */
export interface TestFileObserver {
  /**
   * Run one case, and record what it ran under its name.
   *
   * `name` is the case's declaration path — `['Checkout', 'applies a coupon']`
   * — which the record joins with ` > ` after the file path. The case is over
   * when `body` returns, or when the promise it returns settles. Everything
   * that ran before the file's first case is recorded as loaded by the file:
   * its imports, its top level, and any hook the runner ran before that case.
   */
  case<Result>(name: string | readonly string[], body: () => Result): Result;
  /** Write the file's journal. Call it once, after its last case. */
  finish(): void;
}

/** The file being observed in this realm, so a second one opened beside it is refused. */
let observing: string | undefined;

/**
 * Observe one test file, in the process that runs it and before it loads the
 * file.
 *
 * One file at a time per process: probes write to the file observed now, so a
 * runner that loads every file first and runs their cases later has nothing to
 * tell one file's evaluation from the next one's. Answers `undefined` outside a
 * recording, so the same runner code runs either way.
 */
export function observeTestFile(file: string): TestFileObserver | undefined {
  const recording = carried();
  if (recording === undefined) return undefined;
  const testFile = resolve(file);
  if (observing !== undefined) {
    throw new Error(
      `variance-authority is still observing ${observing}, and ${testFile} was opened beside it. ` +
        'A process records one test file at a time: call finish() on the first before observing the next.',
    );
  }
  observing = testFile;
  // Given the checkout, the scope names a precondition's call site from it, as
  // every other host's does, and keeps what Eyes hands each case.
  const collector = collectors.scoped(globalThis as { __VA__?: unknown }, recording.continuations, undefined, recording.root);
  let loaded: ReadonlyMap<ModuleId, Uint32Array> | undefined;
  let ordinal = 0;
  let finished = false;
  return {
    case(name, body) {
      if (finished) throw new Error(`variance-authority has already finished observing ${testFile}`);
      loaded ??= collector.seal(testFile);
      const declared = typeof name === 'string' ? name : name.join(' > ');
      return (globalThis as unknown as Scoped)[CASE_SCOPE].enter(
        journalFormat.packCase(testFile, declared, String(ordinal++)),
        body,
      );
    },
    finish() {
      if (finished) return;
      finished = true;
      observing = undefined;
      loaded ??= collector.seal(testFile);
      writeJournal(recording, testFile, collector, loaded);
    },
  };
}

/** Where `collectors.scoped` installs the case scope; mirrors `CASE_SCOPE` in `cases.ts`. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

interface Scoped {
  readonly [CASE_SCOPE]: { enter<Result>(key: string, body: () => Result): Result };
}

type Collector = ReturnType<typeof collectors.scoped>;

/**
 * What `jest-setup.cts` writes in its `afterAll`, from the same collector.
 *
 * A runaway made a crossing after its case had settled. The record is right —
 * the crossing went to the case that made it — but the case was not over when
 * the runner said it was, which is what breaks a neighbour. The warning names
 * the cases and leaves the argument here.
 */
function writeJournal(
  recording: Carried,
  testFile: string,
  collector: Collector,
  loaded: ReadonlyMap<ModuleId, Uint32Array>,
): void {
  const stamp = `${process.pid}-${randomUUID()}`;
  const { modules, frames } = collector.finish(testFile);
  mkdirSync(recording.runDirectory, { recursive: true });
  writeFileSync(`${recording.runDirectory}/${stamp}.va`, journalFormat.encodeJournal(testFile, modules, loaded));
  const outlived = collector.runaways();
  if (outlived.length > 0) {
    console.warn(
      `variance-authority: async work still running after its case finished in ${testFile} ` +
        `(recorded against the case that started it):\n  ${outlived.join('\n  ')}`,
    );
  }
  if (frames === undefined || frames.length === 0) return;
  mkdirSync(recording.caseDirectory, { recursive: true });
  writeFileSync(`${recording.caseDirectory}/${stamp}.vac`, journalFormat.packFrames(frames));
}
