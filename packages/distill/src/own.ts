// compass: variance-authority/runtime/attention
import { dominatorsOf } from '@variance-authority/core/relate';
import type { TestCoverage } from '@variance-authority/sense/test-selection';

/**
 * Why a test file loaded a module no case entered.
 *
 * `import`: every path from the test file to the module runs through one
 * import, `importer` → `imported`, and nothing behind that import is entered
 * by a case; it is the topmost such import. `shared`: no import brings the
 * module in alone — two paths reach it, or the import that does also brings in
 * code a case entered; `parts` is the nearest file every path to it runs
 * through. `unseen`: no static import reaches it from the test file, so a
 * dynamic import, a `require` the graph does not read, or the runner brought
 * it in.
 */
export type LoadCause =
  | { readonly kind: 'import'; readonly importer: string; readonly imported: string }
  | { readonly kind: 'shared'; readonly parts: string }
  | { readonly kind: 'unseen' };

/** What the cause of a load is read from. */
export interface CauseInput {
  /** The test file, as the record spells it. */
  readonly file: string;
  /** The files a file imports statically — imports, re-exports and assets — by the names the record uses. */
  readonly imports: (file: string) => readonly string[];
  readonly coverage: TestCoverage;
  /** Each measured module the file loaded, mapped to how many of its cases entered it. */
  readonly entered: ReadonlyMap<string, number>;
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
  const rows = new Map(input.coverage.modules.map((module) => [module.file, module]));
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
      found = [...new Set(input.imports(node))].filter(followed);
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
  // A barrel declares nothing a case could enter: measured, and holding only its top level, it is unused too.
  const unused = (node: string): boolean => {
    const count = input.entered.get(node);
    if (count !== undefined) return count === 0;
    const row = rows.get(node);
    return row?.instrumented === true && row.blocks.every((block) => block.kind === 'module');
  };

  return (module) => {
    if (!idom.has(module)) return { kind: 'unseen' };
    let owner: LoadCause | undefined;
    for (const at of ancestry(module)) {
      if (!unused(at) || carriesUse.has(at)) continue;
      // A predecessor `at` dominates closes a cycle back into it; every other one is a way in.
      const ways = (predecessors.get(at) ?? []).filter((from) => !dominates(at, from));
      if (ways.length === 1) owner = { kind: 'import', importer: ways[0]!, imported: at };
    }
    return owner ?? { kind: 'shared', parts: idom.get(module)! };
  };
}
