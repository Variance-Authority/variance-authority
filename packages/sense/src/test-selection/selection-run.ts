/**
 * One recording, shared by every half of a seam that takes part in it.
 *
 * The two halves of a runner seam never land in the same module. A Vitest run
 * with `projects` is several configuration files, each evaluated on its own:
 * transforms belong to a project, while reporters are a root-only option. An
 * Rstest run puts its transform in an Rspack loader, which the bundler loads by
 * path and not through the configuration that named it. Either way the halves
 * have to find each other, and a module-level variable cannot do it.
 *
 * Keyed by the snapshot being written, on the realm, because that is exactly the
 * scope a run has: one runner process, one coverage file, however many
 * configuration modules and loader instances were evaluated to describe it.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { InstrumentMode, ModuleId } from '../instrument/index.js';
import { defaultInclude, type CapturedModule } from './instrumented-modules.js';

export interface SelectionRun {
  readonly root: string;
  readonly runDirectory: string;
  /** Beside the run directory rather than inside it: the fold there reads every name it finds. */
  readonly caseDirectory: string;
  /**
   * Where a worker's case runner writes the task tree of each file it
   * finished. The reporter is handed the same tree; this copy is what the run
   * folds from when a command-line `--reporter` replaced the reporter.
   */
  readonly finishedDirectory: string;
  /**
   * Where the run's sequencer writes the cases a selection skips, for the case
   * runner in each worker to read between collecting a file and running it.
   * See `case-cut.ts`.
   */
  readonly cutFile: string;
  /** The cases the selection skips in the files this run kept: each such file is recorded incomplete. */
  readonly cut: Map<string, readonly string[]>;
  readonly modules: Map<ModuleId, CapturedModule>;
  /** Every file whose text every observation depended on, whichever configuration ran it. */
  readonly preconditions: Set<string>;
  /**
   * What each configuration's own tests depended on, keyed by the config file
   * Vite loaded — see `governing-config.ts`.
   */
  readonly configs: Map<string, Set<string>>;
  /** The configuration that describes the run, once the runner has said which. */
  runConfig: string | undefined;
  readonly mode: InstrumentMode;
  /**
   * Which transformed modules are product source, for a transform that is not
   * in the configuration that decided it.
   *
   * A Vite plugin is an object the wrapper builds and can close over the
   * predicate; an Rspack loader is a path the bundler loads on its own, and
   * loader options cross into the bundler's core as data. So the run carries
   * it, and `defaultInclude` stands until a wrapper says otherwise.
   */
  include: (file: string) => boolean;
  /** Files this seam generated, which no transform may instrument. */
  readonly shims: Set<string>;
  /**
   * Directories this run created to hold its shims, deepest first. Only these
   * may come off with them: a directory the project already had is the
   * project's, whatever is in it.
   */
  readonly made: Set<string>;
  /** Whether this run records per-case crossings: every run does, unless its files run in a page. */
  cases: boolean;
  /**
   * Whether the run in progress has been folded.
   *
   * A runner may announce one end through two hooks, and it folds once. A
   * runner that watches starts another run in the same process, and
   * {@link reopenRun} clears this at that start.
   */
  settled: boolean;
  /**
   * Whether the runner runs again in this process. The shims stay on disk
   * until it closes, because every rerun's workers load them.
   */
  watching: boolean;
  /**
   * Whether the run lands on no base: it is one shard of a run that selects
   * nothing, set once the runner has said so. See `recordsAlone`.
   */
  alone: boolean;
}

const RUNS = Symbol.for('variance-authority.test-selection.runs');

/** The run this snapshot belongs to, minting it the first time anybody asks. */
export function runFor(coverageFile: string, root: string, mode: InstrumentMode): SelectionRun {
  const carrier = globalThis as { [RUNS]?: Map<string, SelectionRun> };
  const runs = (carrier[RUNS] ??= new Map<string, SelectionRun>());
  const found = runs.get(coverageFile);
  if (found !== undefined) return found;
  const run = newRun(coverageFile, root, mode);
  runs.set(coverageFile, run);
  return run;
}

/**
 * A run nobody else can find: its directories beside the snapshot, and the
 * numbering the last fold published.
 *
 * The seams whose halves meet in one process register it with {@link runFor};
 * `runner.ts` hands its halves the run through the environment instead.
 */
export function newRun(coverageFile: string, root: string, mode: InstrumentMode): SelectionRun {
  const runDirectory = resolve(dirname(coverageFile), `.run-${process.pid}-${randomUUID()}`);
  return {
    root,
    runDirectory,
    caseDirectory: `${runDirectory}-cases`,
    finishedDirectory: `${runDirectory}-files`,
    cutFile: `${runDirectory}-cut.json`,
    cut: new Map<string, readonly string[]>(),
    modules: new Map<ModuleId, CapturedModule>(),
    preconditions: new Set<string>(),
    configs: new Map<string, Set<string>>(),
    runConfig: undefined,
    mode,
    include: defaultInclude,
    shims: new Set<string>(),
    made: new Set<string>(),
    cases: true,
    settled: false,
    watching: false,
    alone: false,
  };
}

/**
 * Open the run for the next end the runner announces: the start of a rerun.
 *
 * The directories are the ones the workers were handed when the shims were
 * written. The last fold removed them, and each worker recreates the one it
 * writes to, so a rerun's journals are its own.
 */
export function reopenRun(run: SelectionRun): void {
  run.settled = false;
}

/** The run a half that was handed only the snapshot's path is taking part in. */
export function runOf(coverageFile: string): SelectionRun | undefined {
  return (globalThis as { [RUNS]?: Map<string, SelectionRun> })[RUNS]?.get(coverageFile);
}

/**
 * Put one of this seam's own modules on disk, and answer with its path.
 *
 * The setup module and the case runner used to be virtual ids a plugin resolved
 * and loaded. Vitest 4 loads both through Vite's module runner, which resolves
 * them before any plugin of the test config is consulted: the ids come back
 * `ERR_MODULE_NOT_FOUND`, and the shape of the failure is the reason this is a
 * file now rather than a special case. The runner one reports *no tests* and
 * still writes an execution index — green, and empty. A real absolute path needs
 * no plugin on any major, and an Rspack build resolves one the same way.
 *
 * Written every time rather than when absent: the source is this package's, so a
 * version bump has to land, and a stale file here would be another release's
 * shim wrapping this one's run. `.mjs`, because the project it lands in may not
 * declare `"type": "module"`.
 *
 * A directory this call had to create is noted on the run, so the run can take
 * it off with its shims — see {@link removeSeamModules}. Left behind, an empty
 * `.variance-authority/` in the project is a trace of a run that has nothing
 * left in it.
 */
export function writeSeamModule(run: Pick<SelectionRun, 'made'>, id: string, source: string): string {
  try {
    return writeShim(run, id, source);
  } catch (error) {
    // Another run that made the directory took it off, empty, between this
    // one finding it and writing into it; this run makes it again, and owns it.
    if (!isErrno(error, 'ENOENT')) throw error;
    return writeShim(run, id, source);
  }
}

function writeShim(run: Pick<SelectionRun, 'made'>, id: string, source: string): string {
  // `mkdirSync` answers with the first directory it had to create, and with
  // nothing when every one was there: whether this run made it is that answer.
  const first = mkdirSync(dirname(id), { recursive: true });
  if (first !== undefined) {
    for (let made = dirname(id); ; made = dirname(made)) {
      run.made.add(made);
      if (made === first || made === dirname(made)) break;
    }
  }
  writeFileSync(id, source, 'utf8');
  leaveOnExit(run, id);
  return id;
}

/** Shims on disk that no end of their run has taken off yet, with the run that wrote each. */
const onDisk = new Map<string, Pick<SelectionRun, 'made'>>();
let exitHooked = false;

/**
 * Take `id` off when the process exits, if nothing took it off before.
 *
 * The shims are written while the configuration is evaluated, and the end of
 * the run is what takes them off: the fold, or the server closing. A runner
 * that fails between the two exits with neither — Vitest rejecting a typecheck
 * it could not start calls no reporter and closes no server — and the files it
 * leaves in the project are a trace of a run that recorded nothing. The exit
 * is the one end every such failure still reaches, and taking a file off is
 * synchronous, so it can happen there.
 */
function leaveOnExit(run: Pick<SelectionRun, 'made'>, id: string): void {
  if (!exitHooked) {
    exitHooked = true;
    process.once('exit', () => {
      for (const [shim, owner] of onDisk) removeSeamModules(owner, [shim]);
    });
  }
  onDisk.set(id, run);
}

/**
 * Take this seam's modules off disk, and every directory the run made for them
 * that they leave empty.
 *
 * `rmdir` refuses a directory that holds anything, which is the whole of the
 * emptiness check: a shim of a run still going, or a file somebody put there,
 * keeps the directory where it is, and a later call tries again.
 *
 * The directories are tidied, not required gone: an empty one left on disk is
 * a trace nothing reads, so a run whose tests passed does not fail over one the
 * platform would not let go of — a lock, a scanner, a read-only mount.
 */
export function removeSeamModules(run: Pick<SelectionRun, 'made'>, shims: Iterable<string>): void {
  for (const shim of shims) {
    rmSync(shim, { force: true });
    onDisk.delete(shim);
  }
  for (const directory of run.made) {
    try {
      rmdirSync(directory);
    } catch (error) {
      // Still holding something, or held by the platform: it stays on the run,
      // and a later call tries again.
      if (!isErrno(error, 'ENOENT')) continue;
    }
    run.made.delete(directory);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

/** The pid-and-uuid stamp a run names its directories and its shims after. */
export function runStamp(run: SelectionRun): string {
  return basename(run.runDirectory).replace(/^\.run-/, '');
}
