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
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { InstrumentMode, ModuleId } from '../instrument/index.js';
import { readModuleNames, type ModuleNames } from '../module-names.js';
import { defaultInclude, openModuleNames, type CapturedModule } from './instrumented-modules.js';

export interface SelectionRun {
  readonly root: string;
  readonly runDirectory: string;
  /** Beside the run directory rather than inside it: the fold there reads every name it finds. */
  readonly caseDirectory: string;
  readonly modules: Map<ModuleId, CapturedModule>;
  /** Union over the projects: every file whose text every observation depended on. */
  readonly preconditions: Set<string>;
  readonly names: ModuleNames;
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
  /** Whether this run records per-case crossings: every run does, unless its files run in a page. */
  cases: boolean;
  /** The snapshot is written once, by whichever hook the runner calls. */
  settled: boolean;
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
    modules: new Map<ModuleId, CapturedModule>(),
    preconditions: new Set<string>(),
    // Once per process, before any module is transformed: the table this run
    // reads is the one the last fold published, and this run's own fold grows it.
    names: readModuleNames(openModuleNames(root)),
    mode,
    include: defaultInclude,
    shims: new Set<string>(),
    cases: true,
    settled: false,
  };
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
 */
export function writeSeamModule(id: string, source: string): string {
  mkdirSync(dirname(id), { recursive: true });
  writeFileSync(id, source, 'utf8');
  return id;
}

/** The pid-and-uuid stamp a run names its directories and its shims after. */
export function runStamp(run: SelectionRun): string {
  return basename(run.runDirectory).replace(/^\.run-/, '');
}
