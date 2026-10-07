/**
 * Every name a record holds a source file under, read from the record itself.
 *
 * The recorder names a built module by its source through the map beside it, so
 * most built output is already recorded under the source's name. A module the
 * map cannot carry back keeps the name it was loaded under: one that holds only
 * types compiles to `export {};` with a map that has no mappings. A package's
 * own tests load its source, so that file is held under two names, and an edit
 * that names the source still reaches the test that loaded only the built copy.
 *
 * The `tsconfig` that builds the package owns which output is whose
 * (`emitted.ts`), so each recorded name is asked of it, once per record, and a
 * name no layout claims stays a name of its own. A changed source the checkout
 * no longer holds was deleted, and its built copy is still its name.
 */

// compass: variance-authority.reach

import { statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { emittedFrom } from '../emitted.js';
import type { TestCoverageView } from './format-view.js';

/** `file` and every recorded name built from it, the file first; `changed` are the diff's files, deleted ones among them. */
export function builtNamesOf(
  coverage: TestCoverageView,
  root: string,
  changed: Iterable<string> = [],
): (file: string) => readonly string[] {
  let built: Map<string, string[]> | undefined;
  return (file) => {
    built ??= builtFrom(coverage, root, new Set([...changed].map((name) => resolve(root, name))));
    const names = built.get(file);
    return names === undefined ? [file] : [file, ...names];
  };
}

function builtFrom(coverage: TestCoverageView, root: string, changed: ReadonlySet<string>): Map<string, string[]> {
  const emitted = emittedFrom((path) => changed.has(path) || statSync(path, { throwIfNoEntry: false })?.isFile() === true);
  const built = new Map<string, string[]>();
  let previous: number | undefined;
  // The paths are sorted, so a path two rows share is asked once.
  for (let module = 0; module < coverage.modulePath.length; module += 1) {
    const id = coverage.modulePath.at(module);
    if (id === previous) continue;
    previous = id;
    const name = coverage.string(id);
    const source = emitted(resolve(root, name));
    if (typeof source !== 'string') continue;
    const file = relative(root, source).split(sep).join('/');
    if (file === name) continue;
    const names = built.get(file);
    if (names === undefined) built.set(file, [name]);
    else names.push(name);
  }
  return built;
}
