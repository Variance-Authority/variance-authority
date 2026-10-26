/**
 * Where a name a file only passes on is declared.
 *
 * `export { taxOf as levy } from './tax.js'` exports `levy` and declares
 * nothing, so the line that exports it is not the answer to where it is. The
 * source index records which name each `export … from` passes on as which, and
 * which file the request resolved to; it walks back through every such file to
 * the one whose top-level declarations hold the name.
 */

// compass: variance-authority.report.agent-surface

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Named } from '@variance-authority/package/help';
import { declarationPassedOn, type PassedOnDeclaration } from '@variance-authority/sense';
import { writtenAt } from './declared.js';

/**
 * The declaration `held` passes on with `export … from`, through every file
 * that passes it on. None when `held`'s file declares it, when the walk ends
 * short of a declaration, when no checkout is named, and when the index is not
 * published or does not read, which the imports of the same answer already
 * say.
 */
export function originOf(root: string | undefined, held: Named): PassedOnDeclaration | undefined {
  if (root === undefined) return undefined;
  try {
    return declarationPassedOn(root, held.at, held.name) ?? undefined;
  } catch {
    return undefined;
  }
}

/** `passes on `taxOf`, declared at <file>:<line>`, for a sentence to carry. */
export function passesOn(origin: PassedOnDeclaration): string {
  return `passes on \`${origin.name}\`, declared at ${origin.at}:${origin.line}`;
}

/**
 * The rows that open the answer for `name`, which `held` exports and no entry
 * publishes: the name and its kind, where it is exported, and what the source
 * index says it is — its kind, signature and documentation, read where it is
 * declared. That is `held`'s file, or, when `held` passes the name on with
 * `export … from`, the file it is passed on from, said by `It passes on …:`.
 * The line itself, as the checkout holds it, when the index holds no
 * declaration there; neither when no checkout is named. `declared` is where
 * the declaration is, `held` when it passes none on.
 */
export function exportedRows(root: string | undefined, name: string, held: Named): { readonly declared: Named; readonly rows: readonly string[] } {
  const origin = originOf(root, held);
  const declared: Named = origin === undefined ? held : { ...held, ...origin };
  const written = writtenAt(root, declared.name, declared.at, declared.line);
  const text = written?.rows ?? (root === undefined ? [] : lineOf(root, declared));
  return {
    declared,
    rows: [
      written === undefined ? name : `${name} [${written.kind}]`,
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
