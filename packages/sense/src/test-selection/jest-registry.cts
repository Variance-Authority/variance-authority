/**
 * Jest's module registry, held against what a test file's journal says it
 * entered.
 *
 * `require.cache` inside a test file is Jest's registry for that file, keyed by
 * absolute path. A module there was evaluated in this realm, so its top level
 * ran, so its first region was entered: if its probes registered, the journal
 * has to name it. One that is in the registry, registered, and absent from
 * every observation is a recording defect — a bucket lost, a seal that dropped
 * what it closed — and the file fails rather than leave a journal that selects
 * too little.
 *
 * The other way round is no defect. A module can be entered without staying in
 * the registry: `jest.resetModules` empties it, `jest.isolateModules` evaluates
 * into a registry of its own, and automock evaluates the real module in a
 * throwaway one to read its shape. What those entered is recorded, and the
 * registry no longer shows it.
 *
 * A module whose probes never registered — a test file, a setup file Jest
 * evaluated before the collector, anything the transform placed nothing in —
 * is no observation's to name, and is not held against one.
 *
 * What the registry cannot show goes unchecked, never failed: an ES module,
 * which Jest keeps in a registry `require.cache` does not expose, and a module
 * whose key is not the path its id names — a root reached through a symlink,
 * which Jest keys by its real path, or a `dist/` file read as its source.
 *
 * CommonJS for the reason `journal-format.cts` is: the setup file requires it
 * from inside the sandbox.
 */

import path = require('node:path');
import moduleIds = require('./module-id.cjs');
import type { ModuleId } from '../instrument/index.js';

/**
 * The repository-relative path of every module in `cached` whose probes
 * registered and that no id in `entered` names, in registry order.
 *
 * @param cached The registry's keys: absolute paths.
 * @param registered Every id whose probes registered in the realm.
 * @param entered Every id the journal names.
 */
function unentered(
  root: string,
  cached: Iterable<string>,
  registered: Iterable<ModuleId>,
  entered: Iterable<ModuleId>,
): string[] {
  const seen = new Set<string>();
  for (const id of entered) seen.add(moduleIds.pathOf(id));
  // Absolute, so the registry's keys are looked up as they are rather than
  // each made relative: there are as many of them as modules the file loaded.
  const owed = new Map<string, string>();
  for (const id of registered) {
    const file = moduleIds.pathOf(id);
    if (!seen.has(file)) owed.set(path.resolve(root, file), file);
  }
  const missing: string[] = [];
  if (owed.size === 0) return missing;
  for (const key of cached) {
    const file = owed.get(key);
    if (file !== undefined) missing.push(file);
  }
  return missing;
}

export = { unentered };
