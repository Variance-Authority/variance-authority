import { NONE, rangeOf, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { MemberDeclaration } from './cache.js';

/**
 * The member-declaration columns of a source-index generation: per parse,
 * every member of an interface, a type literal or a class the file declares,
 * with its line and the container it is on, and for a Rust field the type it holds as
 * written, `NONE` when it holds none worth following.
 *
 * One offset list, because the module reader records the list only when it is
 * not empty, so the empty range and the absent field are the same fact.
 */

/** Validate and open the columns. The reader answers one parse row as the field to spread into it. */
export function openMemberDeclarations(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number) => { readonly memberDeclarations?: readonly MemberDeclaration[] } {
  const reject = (): never => { throw opened.reject(); };
  const offsets = opened.u32('parses.member-declarations');
  const name = opened.u32('member-declarations.name');
  const line = opened.u32('member-declarations.line');
  const on = opened.u32('member-declarations.on');
  const variant = opened.u8('member-declarations.variant');
  const type = opened.u32('member-declarations.type');
  validateOffsets(offsets, name.length, parseCount, reject);
  if (line.length !== name.length || on.length !== name.length || variant.length !== name.length || type.length !== name.length) reject();

  return (row) => {
    const memberDeclarations = rangeOf(offsets, row, reject).map((at): MemberDeclaration => ({
      name: text(name[at]!),
      line: line[at]!,
      on: text(on[at]!),
      ...(variant[at] === 1 ? { variant: true as const } : {}),
      ...(type[at] === NONE ? {} : { type: text(type[at]!) }),
    }));
    return memberDeclarations.length === 0 ? {} : { memberDeclarations };
  };
}
