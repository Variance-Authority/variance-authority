import type { SemanticNode } from '../format/snapshot.js';

/**
 * How a value that may carry a structural alias is rewritten before hashing.
 *
 * `undefined` for the per-name hashes, which have always hashed the alias the
 * normalizer assigned and must keep doing so byte for byte. Supplied by the
 * per-instance hashes, which need a boundary-local alias space — see
 * {@link ./instances.js}, where the argument for it lives.
 */
export interface Rename {
  readonly attribute: (name: string, value: string) => string;
  readonly style: (value: string) => string;
  readonly alias: (alias: string) => string;
}

export function renamedAlias(node: SemanticNode, rename?: Rename): string | undefined {
  if (rename === undefined || node.alias === undefined) return node.alias;
  return rename.alias(node.alias);
}

export function renamedAttributes(
  node: SemanticNode,
  rename?: Rename,
): Readonly<Record<string, string>> {
  if (rename === undefined) return node.attributes;

  const renamed: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attributes)) {
    renamed[name] = rename.attribute(name, value);
  }
  return renamed;
}

export function renamedTokens(
  node: SemanticNode,
  rename?: Rename,
): Readonly<Record<string, string>> | undefined {
  if (rename === undefined || node.tokens === undefined) return node.tokens;

  const renamed: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.tokens)) {
    renamed[name] = rename.style(value);
  }
  return renamed;
}
