/**
 * When an Rstest run's `preconditions` start to count.
 *
 * Rstest counts a run's test files for no reporter and no plugin, but it makes a
 * compiler before it announces a run only for a test file to build, or for a
 * watch session, which builds with none. So a compiler says the run takes part,
 * and what Rspack is handed says which project does. A run that made none and
 * still finished files is a merge of reports, or ran only a project this seam
 * cannot reach: nothing refuses there, and what can be read still counts.
 */

// compass: variance-authority.reach

import { readable } from './precondition-entries.js';
import type { SelectionRun } from './selection-run.js';

const building = new WeakSet<SelectionRun>();
const declared = new WeakMap<SelectionRun, { own: Set<string>; entries: readonly string[] }[]>();

/** Whether this run has a test file to build, as far as a plugin of the seam heard. */
export const isBuilding = (run: SelectionRun): boolean => building.has(run);

export const noteBuilding = (run: SelectionRun): void => { building.add(run); };

/** Keeps a configuration's entries for a run that builds nothing, as nothing joins them to `own` there. */
export function declareEntries(run: SelectionRun, own: Set<string>, entries: readonly string[]): void {
  declared.set(run, [...declared.get(run) ?? [], { own, entries }]);
}

/** Joins every configuration's entries that can be read. */
export function joinReadableEntries(run: SelectionRun): void {
  for (const { own, entries } of declared.get(run) ?? []) for (const file of readable(entries)) own.add(file);
}

/**
 * Tells a run that a project it cannot wrap made a compiler. Rstest reads no
 * plugin from the configuration that lists the projects, so each project written
 * inline in that list carries this.
 */
export function buildingPlugin(run: SelectionRun) {
  return {
    name: 'variance-authority:test-selection-building',
    setup(api: { readonly onBeforeCreateCompiler: (handler: () => void) => void }): void {
      api.onBeforeCreateCompiler(() => noteBuilding(run));
    },
  };
}

/**
 * Whether what Rstest hands Rspack to build holds a file that `loaded` does not
 * name, which is a test file: its entries are that and a project's setup. A
 * watching run's entry is a function, read at each build, and may yet hold one.
 * A setup file that is a package is named differently and reads as a test file.
 */
export function buildsTestFile(entry: unknown, loaded: ReadonlySet<string>): boolean {
  if (typeof entry === 'function') return true;
  const named = new Set([...loaded].map(forwardSlashed));
  return Object.values(entry ?? {}).some((file) => !named.has(forwardSlashed(file as string)));
}

/** Rspack spells a Windows path with forward slashes, and `resolve` with backslashes. */
function forwardSlashed(file: string): string {
  return file.replaceAll('\\', '/');
}
