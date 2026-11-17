/** One published native graph, under the same local/CI policy as every source reader. */
// compass: variance-authority.reach.relations
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import type { NativeRelations } from '@variance-authority/core/relate';
import { native, nativeRefusal } from './addon.js';
import { entry } from './help-reading.js';
import { CODE_EXTENSIONS } from './language.js';
import type { NativeSelectionGraph, NativeSelectionGraphOptions } from './native-selection-graph.js';
import { publishedThrough, type PublishedSourcesOptions } from './published.js';
import { realPath, type ResolveOptions } from './resolve.js';
import type { Taint } from './taint/index.js';
import { withDeclaredTsconfig } from './typescript.js';

export interface PublishedSelectionOptions extends ResolveOptions {
  readonly dirs: readonly string[];
  readonly before?: readonly string[];
  readonly taints?: readonly Taint[];
  readonly depends?: Iterable<readonly [string, string]>;
  readonly raw?: boolean;
  readonly ci?: boolean;
  readonly step?: string;
  readonly announce?: (line: string) => void;
  readonly index?: string;
  readonly packs?: boolean;
}

/** Sparse typed questions over a source snapshot owned by the native graph. */
export async function publishedSelectionQuestions(root: string, options: PublishedSelectionOptions): Promise<NativeSelectionGraph> {
  const scanner = native();
  if (scanner?.selectionGraphOf === undefined) throw new Error(`the selection graph is read by the native scanner, and ${nativeRefusal() ?? 'the scanner has no `selectionGraphOf`; build it again'}`);
  const where = realPath(resolve(root));
  const configured = withDeclaredTsconfig(where, options);
  const taints = new Map<string, { file: string; plus: string[]; minus: string[] }>();
  for (const taint of options.taints ?? []) {
    if (taint.read !== undefined || taint.parsed !== undefined) throw new Error(`native source selection takes configured taint tables; ${taint.name} is a source reader`);
    for (const [file, diff] of taint.diffs ?? []) {
      const held = taints.get(file) ?? { file, plus: [], minus: [] };
      held.plus.push(...(diff.plus ?? [])); held.minus.push(...(diff.minus ?? []));
      taints.set(file, held);
    }
  }
  const graphOptions: NativeSelectionGraphOptions = {
    root: where, dirs: options.dirs, before: options.before ?? [], code: CODE_EXTENSIONS,
    builtins: builtinModules, taints: [...taints.values()].map((row) => ({ ...row, plus: [...new Set(row.plus)], minus: [...new Set(row.minus)] })),
    depends: [...(options.depends ?? [])].map(([from, to]) => ({ from, to })),
    ...(configured.tsconfig === undefined ? {} : { tsconfig: configured.tsconfig }),
    ...(options.raw === undefined ? {} : { raw: options.raw }),
  };
  const policy: PublishedSourcesOptions = { ci: options.ci ?? false, step: options.step ?? 'variance index', announce: options.announce ?? (() => {}),
    ...(options.index === undefined ? {} : { index: options.index }), ...(options.packs === undefined ? {} : { packs: options.packs }) };
  const result = await publishedThrough(where, policy, async (path) => {
    const opened = entry('openIndex')(path);
    try {
      const status = opened.status();
      return { ...status, graph: status.state === 'published' ? scanner.selectionGraphOf(opened, graphOptions) : null };
    } finally { opened.close(); }
  });
  if (result.graph === null) throw new Error('the source index was not published by its update');
  return result.graph;
}

/** Relations whose graph state stays with its native owner. */
export async function publishedSelectionGraph(root: string, options: PublishedSelectionOptions): Promise<NativeRelations> {
  return { native: await publishedSelectionQuestions(root, options) };
}
