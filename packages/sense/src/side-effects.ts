// compass: variance-authority.reach

/**
 * `@variance-authority/sense/side-effects` — whether a module's package
 * declares that loading it does something, for a package that reads nothing
 * else of Sense.
 *
 * The answer is the one test selection reads, from the native reader: the
 * nearest `package.json` decides, `sideEffects` is `true`, a pattern or a list
 * of patterns, and a source is matched as itself and as every file its
 * package's `tsconfig` writes it to. The isolator asks it to leave such a
 * module shared.
 */

import { native, nativeRefusal } from './addon.js';

/** Of these absolute paths, those whose package declares side effects, in the order asked. */
export function declaresSideEffects(files: readonly string[]): readonly string[] {
  const scanner = native();
  if (scanner?.declaredEffects === undefined) {
    throw new Error(`cannot read which modules declare side effects: ${nativeRefusal() || 'the native reader has no answer for it'}`);
  }
  return scanner.declaredEffects('/', [...files]);
}
