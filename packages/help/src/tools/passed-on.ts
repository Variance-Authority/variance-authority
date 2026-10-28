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
import { declarationExported, type ExportedDeclaration } from '@variance-authority/sense';
import { textRows } from './declared.js';

/**
 * The declaration `held` binds: its file's own, or the one it passes on
 * through every file that passes it on. None when the walk ends short of a
 * declaration, when no checkout is named, and when the index is not published
 * or does not read, which the imports of the same answer already say.
 */
export function boundOf(root: string | undefined, held: Pick<Named, 'at' | 'name'>): ExportedDeclaration | undefined {
  if (root === undefined) return undefined;
  try {
    return declarationExported(root, held.at, held.name) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The declaration `held` passes on from another file, as `boundOf` reaches it; none when its own file declares it. */
export function originOf(root: string | undefined, held: Pick<Named, 'at' | 'name'>): ExportedDeclaration | undefined {
  return elsewhere(boundOf(root, held), held);
}

/**
 * Which declaration `held` exports: the file that declares it and the name
 * that file exports it under, the key the package stage gives every entry it
 * publishes. An export that declares passes its own; one that passes another
 * file's on takes the export of the declaring file that binds the same
 * declaration, so `export { salute } from './greet.js'` over
 * `export { greet as salute }` is `salute` there, not the local `greet`.
 */
export function declarationOf(help: Help, root: string | undefined, held: Named): { readonly at: string; readonly declared: string } {
  const origin = held.declaration !== undefined ? undefined : originOf(root, held);
  if (origin === undefined) return { at: held.at, declared: held.name };
  const own = help.exported.find(
    (other) => other.at === origin.at && other.declaration !== undefined && boundOf(root, other)?.name === origin.name,
  );
  return { at: origin.at, declared: own?.name ?? origin.name };
}

/** `bound`, when it is in another file than `held`. */
const elsewhere = (bound: ExportedDeclaration | undefined, held: Pick<Named, 'at'>): ExportedDeclaration | undefined =>
  bound === undefined || bound.at === held.at ? undefined : bound;

/** `passes on `taxOf`, declared at <file>:<line>`, for a sentence to carry. */
export function passesOn(origin: ExportedDeclaration): string {
  return `passes on \`${origin.name}\`, declared at ${origin.at}:${origin.line}`;
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
export function exportedRows(root: string | undefined, name: string, held: Named): { readonly declared: Named; readonly rows: readonly string[] } {
  const bound = boundOf(root, held);
  const origin = elsewhere(bound, held);
  const declared: Named = origin === undefined ? held : { ...held, at: origin.at, name: origin.name, line: origin.line };
  const text = root === undefined ? [] : bound === undefined ? lineOf(root, declared) : textRows(root, bound);
  return {
    declared,
    rows: [
      bound === undefined ? name : `${name} [${bound.kind}]`,
      `exported, without being published, at ${held.at}:${held.line} by ${held.by}${held.type ? ' (type only)' : ''}`,
      ...(origin === undefined ? [] : [`It ${passesOn(origin)}:`]),
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
