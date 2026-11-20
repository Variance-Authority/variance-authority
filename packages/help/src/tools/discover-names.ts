import type { ToolInvocation, Tree } from '@variance-authority/mcp/tools';
import { namesFilterOf, READABLE, type NameHit, type NamesFound } from '@variance-authority/sense';
import { fileNamed, listArg, nameOf, textArg } from './discover-operands.js';

/**
 * The native answer to every name set of one call, consumed in the order the
 * sets are read, with each file spelled as the tree spells it.
 */
export interface Found {
  /** Each asked set's lines, taken in the order the sets were asked. */
  readonly imports: NamesFound['imports'][number][];
  readonly declares: NamesFound['declares'][number][];
  readonly unread: readonly string[];
  readonly spelled: (file: string) => string;
}

/**
 * Every name set the call says, kept and taken out, asked of the source index
 * in one pass, or the refusal when no index answers. `sourceIndex` is the one
 * the host read the tree from; absent, the one the tree names.
 */
export function foundOf(input: Readonly<Record<string, unknown>>, tree: Tree, invocation: ToolInvocation<unknown> | undefined): Found {
  const imports: { spec: string; name?: string }[] = [];
  const declares: string[] = [];
  for (const prefix of ['', 'except'] as const) {
    for (const written of listArg(input, prefix === '' ? 'imports' : 'exceptImports')) {
      // A name out of a repository file is `importsOf`'s to answer off the index's edges, as `fileNamed` routes it.
      if (fileNamed(written, tree.files) !== undefined) continue;
      const { spec, name } = nameOf(written);
      imports.push({ spec, ...(name === undefined ? {} : { name }) });
    }
    const pattern = textArg(input, prefix === '' ? 'declares' : 'exceptDeclares');
    if (pattern !== undefined) declares.push(pattern);
  }
  const at = invocation?.sourceIndex ?? (tree.index === undefined ? undefined : { index: tree.index, within: '' });
  const ran = '`discover` ran nothing: `declares`, and `imports` of anything but a name out of a repository file, are read from the source index, and';
  if (at === undefined) throw new Error(`${ran} the tree names no source index it was read off.`);
  let read: NamesFound | undefined;
  try {
    read = namesFilterOf(at.index, imports, declares, [...READABLE]);
  } catch (error) {
    throw new Error(`${ran} ${error instanceof Error ? error.message : String(error)}; run \`variance index\`.`);
  }
  if (read === undefined) throw new Error(`${ran} no source index is published; run \`variance index\`.`);
  // The tree drops the workspace's directory from the files under it and spells the rest from the index's root.
  const under = `${at.within}/`;
  const spelled = at.within === '' ? (file: string) => file : (file: string) => (file.startsWith(under) ? file.slice(under.length) : file);
  // The index holds the whole checkout, and a tree read under some directories answers for its own files alone.
  // A workspace's index holds its members beside it too, which its tree walks but does not list.
  const beside = (file: string): boolean => at.within !== '' && !file.startsWith(under);
  const held = (hits: readonly NameHit[]): NameHit[] => hits.filter((hit) => beside(hit.file) || tree.files.has(spelled(hit.file)));
  return {
    imports: read.imports.map(held),
    declares: read.declares.map((asked) => ({ ...asked, hits: held(asked.hits) })),
    unread: read.unread.map(spelled),
    spelled,
  };
}
