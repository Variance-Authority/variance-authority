/**
 * The declaration an export binds.
 *
 * `export { taxOf as levy }` binds `levy` to `taxOf`, and
 * `export { taxOf as levy } from './tax.js'` exports `levy` and declares
 * nothing, so the line that exports a name is not the answer to what it is.
 * The source index records which name each export binds and each
 * `export … from` passes on as which, and which file the request resolved to;
 * it walks back through every such file to the declaration.
 */

// compass: variance-authority.report.agent-surface

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Help, Named } from '@variance-authority/package/help';
import type { ExportedDeclaration } from '@variance-authority/sense';
import { boundOf, originKey, SLOT } from './declaration-key.js';
import { textRows } from './declared.js';


/** `bound`, when it is in another file than `held`. */
const elsewhere = (bound: ExportedDeclaration | undefined, held: Pick<Named, 'at'>): ExportedDeclaration | undefined =>
  bound === undefined || bound.at === held.at ? undefined : bound;

/**
 * `passes on `taxOf`, declared at <file>:<line>`, for a sentence to carry. An
 * anonymous default binds the slot `default`, so it is said by `named`, the
 * name `originKey` keys it by.
 */
export function passesOn(origin: ExportedDeclaration, named: string): string {
  return `passes on \`${origin.name === SLOT ? named : origin.name}\`, declared at ${origin.at}:${origin.line}`;
}

/**
 * The rows that open the answer for `name`, which `held` exports and no entry
 * publishes: the name and its kind, where it is exported, and what the source
 * index says it is — its kind, signature and documentation, read off the
 * declaration the export binds, as `boundOf` reaches it. When that is in
 * another file, `It passes on …:` says which. The line itself, as the checkout
 * holds it, when the walk reaches no declaration; neither when no checkout is
 * named. `declared` is where the declaration is, `held` when it passes none
 * on.
 */
export function exportedRows(help: Help, root: string | undefined, name: string, held: Named): { readonly declared: Named; readonly rows: readonly string[] } {
  const bound = boundOf(root, held);
  const origin = elsewhere(bound, held);
  const declared: Named = origin === undefined ? held : { ...held, at: origin.at, name: origin.name, line: origin.line };
  const text = root === undefined ? [] : bound === undefined ? lineOf(root, declared) : textRows(root, bound);
  return {
    declared,
    rows: [
      bound === undefined ? name : `${name} [${bound.kind}]`,
      `exported, without being published, at ${held.at}:${held.line} by ${held.by}${held.type ? ' (type only)' : ''}`,
      ...(origin === undefined ? [] : [`It ${passesOn(origin, originKey(help, root, origin).named)}:`]),
      ...text,
    ],
  };
}

/**
 * The line an export is written on, as the checkout holds it now; nothing when
 * the file is gone or the line no longer holds the name, since the index read
 * an older text.
 */
export function lineOf(root: string, held: Pick<Named, 'at' | 'line' | 'name'>): readonly string[] {
  let text: string;
  try {
    text = readFileSync(join(root, held.at), 'utf8');
  } catch {
    return [];
  }
  const line = text.split(/\r?\n/)[held.line - 1]?.trim();
  return line === undefined || !line.includes(held.name) ? [] : [line];
}
