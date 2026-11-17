/**
 * The selection an Rstest run reads, applied inside the process: the files it
 * skips join the project's `exclude`, so Rstest never plans them, and no path
 * crosses the command line.
 *
 * Rstest hands its Rsbuild plugins `modifyRstestConfig`, whose callbacks it
 * awaits and then plans the project's entries again. The selection is read
 * there, once the command line is merged in, and against the files the
 * project's own `include` and `exclude` find.
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import picomatch from 'picomatch';
import { kept, selectedLines, type SuiteSelection } from './suite-selection.js';
import { askedSelection } from './selection-environment.js';
import { projectPath } from './instrumented-modules.js';

/**
 * The plugins that apply the selection a run is handed, or else the one
 * `VARIANCE_AUTHORITY_SINCE` asks for: none when it asks for none, and every
 * file runs.
 */
export function selectionPlugins(
  options: { readonly selection?: () => Promise<SuiteSelection>; readonly suite?: string },
  coverageFile: string,
  root: string,
  configRoot: string,
) {
  const request = { root, from: configRoot, ...(options.suite === undefined ? {} : { suite: options.suite }) };
  const selection = askedSelection(options.selection, () => coverageFile, request);
  return selection === undefined ? [] : [selectingPlugin(selection, root)];
}

/**
 * What a configuration listing projects adds when a selection is asked for:
 * Rstest reads `passWithNoTests` there, not on a project, so a run every
 * project's selection emptied runs nothing and passes, as Jest's wrap does.
 */
export function rootSelection(
  options: { readonly selection?: () => Promise<SuiteSelection>; readonly suite?: string },
  coverageFile: string,
  root: string,
  configRoot: string,
): { passWithNoTests?: true } {
  return selectionPlugins(options, coverageFile, root, configRoot).length === 0 ? {} : { passWithNoTests: true };
}

/** The part of a project's configuration, as `modifyRstestConfig` hands it, that the selection reads and extends. */
interface PlannedConfig {
  readonly root: string;
  readonly include: readonly string[];
  exclude: { patterns: string[] };
  passWithNoTests?: boolean;
}

/** The part of Rsbuild's plugin API this plugin reads. */
interface SelectingApi {
  readonly useExposed: (id: string) => {
    readonly modifyRstestConfig?: (callback: (config: PlannedConfig) => Promise<void>) => void;
  } | undefined;
}

/**
 * The plugin that leaves out of a project the files `selection` skips, and
 * says what it kept. A project it keeps no file of runs nothing and passes.
 *
 * `root` is the checkout the selection names files against. Case grain is
 * refused: a kept file runs whole here, and a run that asked for less would
 * read as having had it.
 */
export function selectingPlugin(
  selection: () => Promise<SuiteSelection>,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    name: 'variance-authority:selection',
    setup(api: SelectingApi): void {
      api.useExposed('rstest')?.modifyRstestConfig?.(async (config) => {
        if (env['VARIANCE_AUTHORITY_GRAIN'] === 'case') throw caseGrain();
        const asked = await selection();
        if (asked.cases !== undefined && asked.cases.size > 0) throw caseGrain();
        const found = projectFiles(config);
        const name = (file: string): string => projectPath(root, file);
        const runs = new Set(kept(asked, found, name));
        for (const line of selectedLines(asked, found.map(name))) console.error(line);
        const skipped = found.filter((file) => !runs.has(file));
        config.exclude.patterns.push(...skipped.map((file) => escaped(projectPath(config.root, file))));
        if (runs.size === 0) config.passWithNoTests = true;
      });
    },
  };
}

function caseGrain(): Error {
  return new Error(
    'variance-authority: VARIANCE_AUTHORITY_GRAIN=case is not kept under Rstest, which runs every kept file whole; ' +
      'unset it to leave out whole files.',
  );
}

/** The test files a project's `include` finds under its root and its `exclude` leaves in, absolute. */
function projectFiles(config: PlannedConfig): string[] {
  const included = picomatch([...config.include], { dot: true });
  const excluded = picomatch(config.exclude.patterns.length === 0 ? ['\0'] : config.exclude.patterns, { dot: true });
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        const at = projectPath(config.root, path);
        if (included(at) && !excluded(at)) files.push(path);
      }
    }
  };
  walk(config.root);
  return files.sort();
}

/** A path as a glob that matches it alone: its glob characters escaped, unlike a regular expression's. */
function escaped(path: string): string {
  return path.replace(/[*?[\]{}()!+@\\]/g, '\\$&');
}
