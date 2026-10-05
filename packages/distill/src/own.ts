// compass: variance-authority/runtime/attention
import { dominatorsOf } from '@variance-authority/core/relate';
import type { TestCoverage } from '@variance-authority/sense/test-selection';

/**
 * Why a test file loaded a module no case entered.
 *
 * `import`: every path from the test file to the module runs through one
 * import, `importer` → `imported`, and nothing behind that import is entered
 * by a case; it is the topmost such import. `lazy` when that import is
 * dynamic only: what it owns was paid when the import was called, not on load.
 * `shared`: no import brings the module in alone — two paths reach it, or the
 * import that does also brings in code a case entered; `parts` is the nearest
 * file every path to it runs through. `unseen`: no import the graph reads
 * reaches it from the test file, so a dynamic import whose specifier is not a
 * literal, or the runner, brought it in.
 */
export type LoadCause =
  | { readonly kind: 'import'; readonly importer: string; readonly imported: string; readonly lazy?: true }
  | { readonly kind: 'shared'; readonly parts: string }
  | { readonly kind: 'unseen' };

/** How an owning import reads in text: a lazy one says it was paid when it ran. */
export function importOf(cause: { readonly importer: string; readonly imported: string; readonly lazy?: true }): string {
  return `${cause.importer} ${cause.lazy === true ? 'lazily imports' : 'imports'} ${cause.imported}`;
}

/** The heading over what no one import owns. */
export const SHARED = 'No one import brings these in alone';
/** The heading over what no import the graph reads brought in. */
export const UNSEEN = 'No import the graph reads reaches these from the test file';

/** What the cause of a load is read from. */
export interface CauseInput {
  /** The test file, as the record spells it. */
  readonly file: string;
  /** The files a file imports statically — imports, re-exports and assets — by the names the record uses. */
  readonly imports: (file: string) => readonly string[];
  /** The files a file imports dynamically, by a literal specifier. Unsaid, a lazy import owns nothing and its files read as unseen. */
  readonly lazy?: (file: string) => readonly string[];
  /** Whether every file a file imports, it also re-exports: a barrel. Unsaid, no file reads as one. */
  readonly republishes?: (file: string) => boolean;
  readonly coverage: TestCoverage;
  /** Each measured module the file loaded, mapped to how many of its cases entered it. */
  readonly entered: ReadonlyMap<string, number>;
}

type Row = TestCoverage['modules'][number];
const rowsByCoverage = new WeakMap<TestCoverage, ReadonlyMap<string, Row>>();

/** The record's rows by file, built once however many test files are read from it. */
function rowsOf(coverage: TestCoverage): ReadonlyMap<string, Row> {
  let rows = rowsByCoverage.get(coverage);
  if (rows === undefined) rowsByCoverage.set(coverage, (rows = new Map(coverage.modules.map((module) => [module.file, module]))));
  return rows;
}

/**
 * The cause of each load, read as dominance over the imports the test file
 * actually followed.
 *
 * The walk leaves out a file the record holds that this test file did not
 * load: a module mocked with a factory is never evaluated, so its edge is cut,
 * while an automocked one is evaluated and stays. A file the record does not
 * hold is kept, because the record cannot say it was not loaded; keeping it can
 * only turn an owned load into a shared one, never the reverse.
 */
export function causesOf(input: CauseInput): (module: string) => LoadCause {
  const rows = rowsOf(input.coverage);
  const followed = (target: string): boolean => {
    const row = rows.get(target);
    if (row === undefined) return true;
    return row.blocks.find((block) => block.kind === 'module')?.loadedBy?.includes(input.file) === true;
  };
  const edges = new Map<string, readonly string[]>();
  const successors = (node: string): readonly string[] => {
    let found = edges.get(node);
    if (found === undefined) {
      // An import and a re-export of one module are one way in.
      found = [...new Set([...input.imports(node), ...(input.lazy?.(node) ?? [])])].filter(followed);
      edges.set(node, found);
    }
    return found;
  };

  const idom = dominatorsOf(input.file, successors);
  const predecessors = new Map<string, string[]>();
  for (const node of [input.file, ...idom.keys()]) {
    for (const next of successors(node)) {
      const into = predecessors.get(next);
      if (into === undefined) predecessors.set(next, [node]);
      else into.push(node);
    }
  }
  const ancestry = (node: string): string[] => {
    const chain: string[] = [];
    for (let at: string | undefined = node; at !== undefined && at !== input.file; at = idom.get(at)) chain.push(at);
    return chain;
  };
  // A file that dominates a module some case entered carries used code: its import is not removable.
  const carriesUse = new Set<string>();
  for (const [module, count] of input.entered) {
    if (count > 0 && idom.has(module)) for (const at of ancestry(module)) carriesUse.add(at);
  }
  const dominates = (by: string, node: string): boolean => ancestry(node).includes(by);
  // A barrel declares nothing a case could enter, so measured and holding only its top level it is unused too.
  // A file of constants looks the same in the record and a case may read it unrecorded: only a file that
  // re-exports all it imports reads as a barrel.
  const unused = (node: string): boolean => {
    const count = input.entered.get(node);
    if (count !== undefined) return count === 0;
    const row = rows.get(node);
    return row?.instrumented === true
      && row.blocks.every((block) => block.kind === 'module')
      && input.republishes?.(node) === true;
  };

  return (module) => {
    if (!idom.has(module)) return { kind: 'unseen' };
    let owner: LoadCause | undefined;
    for (const at of ancestry(module)) {
      if (!unused(at) || carriesUse.has(at)) continue;
      // A predecessor `at` dominates closes a cycle back into it; every other one is a way in.
      const ways = (predecessors.get(at) ?? []).filter((from) => !dominates(at, from));
      if (ways.length !== 1) continue;
      const importer = ways[0]!;
      // A static import of the same module evaluates it on load, whatever else imports it lazily.
      const lazy = !input.imports(importer).includes(at);
      owner = { kind: 'import', importer, imported: at, ...(lazy ? { lazy: true as const } : {}) };
    }
    return owner ?? { kind: 'shared', parts: idom.get(module)! };
  };
}
