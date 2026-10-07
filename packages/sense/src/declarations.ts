/**
 * The component index of one module, read off its tree.
 *
 * Attribution resolves a component name to `file:line` through a
 * {@link SourceIndex}. The names are the ones the module reader declares —
 * functions, classes and `const` or `let` bindings of the module's own top-level
 * statements whose name starts with a capital, outside tests, stories and
 * declaration files ([`declarations.rs`](../native/src/declarations.rs)) — and
 * each is placed at the line of the statement that declares it, which the same
 * parse already gives every symbol. A declaration a comment or a string spells is
 * not code and declares nothing, and a file the parser cannot read declares
 * nothing either; its record says why.
 */

import type { SourceIndex, SourceRef } from '@variance-authority/core/attribute';
import { readModule } from './read.js';

/** How a declaring statement's kind is shown on a {@link SourceRef}. */
const VIA: Readonly<Record<string, SourceRef['via']>> = { function: 'function', class: 'class', const: 'const', let: 'const' };

/**
 * The components `file` declares, from its text, each at the first statement
 * that declares it. `file` is the name the index carries, and its extension
 * decides how the text is parsed.
 */
export function indexDeclarations(file: string, contents: string): SourceIndex {
  const read = readModule(file, contents);
  const declared = new Set(read.declares);
  const found: Record<string, SourceRef[]> = {};
  for (const symbol of read.symbols ?? []) {
    const via = VIA[symbol.kind];
    if (via === undefined || !declared.has(symbol.name) || found[symbol.name] !== undefined) continue;
    found[symbol.name] = [{ file, line: symbol.line, via }];
  }
  return found;
}
