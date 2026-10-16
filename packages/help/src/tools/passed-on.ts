/**
 * Where a name a file only passes on is declared.
 *
 * `export { taxOf as levy } from './tax.js'` exports `levy` and declares
 * nothing, so the line that exports it is not the answer to where it is. The
 * source index records which name each `export … from` passes on as which, and
 * which file the request resolved to; it walks back through every such file to
 * the one that declares the name, and the export there has the line.
 */

// compass: variance-authority.report.agent-surface

import type { Help, Named } from '@variance-authority/package/help';
import { passedFrom } from '@variance-authority/sense';

/** The declaration an export passes on: its file, the name it has there, and its line when that file's export of it is read. */
export interface Origin {
  readonly at: string;
  readonly name: string;
  readonly line?: number;
}

/**
 * The declaration `held` passes on with `export … from`, through every file
 * that passes it on; none when `held`'s file declares it, when no checkout is
 * named, or when the index is not published or does not read, which the
 * imports of the same answer already say.
 */
export function originOf(help: Help, root: string | undefined, held: Named): Origin | undefined {
  if (root === undefined) return undefined;
  let hops: ReturnType<typeof passedFrom>;
  try {
    hops = passedFrom(root, held.at, held.name);
  } catch {
    return undefined;
  }
  const last = hops?.at(-1);
  if (last === undefined) return undefined;
  const declared = help.exported.find((one) => one.at === last.at && one.name === last.name);
  return declared === undefined ? last : { ...last, line: declared.line };
}

/** `passes on `taxOf`, declared at <file>:<line>`, for a sentence to carry. */
export function passesOn(origin: Origin): string {
  return `passes on \`${origin.name}\`, declared at ${origin.at}${origin.line === undefined ? '' : `:${origin.line}`}`;
}
