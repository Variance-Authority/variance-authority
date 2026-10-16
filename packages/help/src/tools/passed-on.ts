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
 * The declaration `held` passes on, or `held` itself when it passes none on,
 * and the rows that say so: `It passes on …:` and the declaration's line as
 * the checkout holds it. No rows when `held` declares the name or no checkout
 * is named.
 */
export function passedOnRows(root: string | undefined, held: Named): { readonly declared: Named; readonly rows: readonly string[] } {
  const origin = originOf(root, held);
  if (origin === undefined || root === undefined) return { declared: held, rows: [] };
  const declared: Named = { ...held, ...origin };
  return { declared, rows: [`It ${passesOn(origin)}:`, ...lineOf(root, declared)] };
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
