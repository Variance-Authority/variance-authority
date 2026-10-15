// compass: variance-authority/runtime/attention
import type { ImportCharge } from './charge.js';

/**
 * Why a test file loaded a module no case entered.
 *
 * `import`: every path from the test file to the module runs through one
 * import, `importer` → `imported`, and nothing behind that import is entered
 * by a case; it is the topmost such import. `lazy` when that import is
 * dynamic only: what it owns was paid when the import was called, not on load.
 * `charge`, for a static import, says where its importer references what it
 * imports. `reach`, for a static import,
 * says how far from the test file its importer is, and `exports`, for an
 * import the subject writes, every value the imported module exports.
 * `shared`: no import brings the module in alone — two paths reach it, or the
 * import that does also brings in code a case entered; `parts` is the nearest
 * file every path to it runs through. `unseen`: no import the graph reads
 * reaches it from the test file, so a dynamic import or `require` whose
 * specifier is not a quoted string, or the runner, brought it in.
 */
export type LoadCause =
  | {
    readonly kind: 'import';
    readonly importer: string;
    readonly imported: string;
    readonly lazy?: true;
    readonly charge?: ImportCharge;
    readonly reach?: ImportReach;
    readonly exports?: readonly string[];
  }
  | { readonly kind: 'shared'; readonly parts: string }
  | { readonly kind: 'unseen' };

/**
 * How far from the test file the importer of an import is, which decides what
 * to do about it. `test`: the test file writes it, an error to fix there.
 * `subject`: a file the test file imports writes it, so the test file may mock
 * it. `beyond`: a file further away writes it, which the test file does not
 * know; mocking it there would tie the test to that file's internals, so the
 * fix is in the importer.
 */
export type ImportReach = 'test' | 'subject' | 'beyond';

/** How an owning import reads in text: a lazy one says it was paid when it ran. */
export function importOf(cause: { readonly importer: string; readonly imported: string; readonly lazy?: true }): string {
  return `${cause.importer} ${cause.lazy === true ? 'lazily imports' : 'imports'} ${cause.imported}`;
}

/** The heading over what no one import owns. */
export const SHARED = 'No one import brings these in alone';
/** The heading over what no import the graph reads brought in. */
export const UNSEEN = 'No import the graph reads reaches these from the test file';
