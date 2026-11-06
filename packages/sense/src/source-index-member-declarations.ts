import { rangeOf, sameLength, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { MemberDeclaration } from './cache.js';
import { spanAt } from './source-index-harvest.js';

/**
 * The member-declaration columns of a source-index generation: per parse,
 * every member of an interface, a type literal or a class the file declares,
 * with its line, the container it is on and the doc written above it.
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
  const docStart = opened.u32('member-declarations.doc-start');
  const docEnd = opened.u32('member-declarations.doc-end');
  validateOffsets(offsets, name.length, parseCount, reject);
  sameLength(name.length, [line, on, docStart, docEnd], reject);

  return (row) => {
    const memberDeclarations = rangeOf(offsets, row, reject).map((at): MemberDeclaration => {
      const doc = spanAt(docStart, docEnd, at, reject);
      return {
        name: text(name[at]!),
        line: line[at]!,
        on: text(on[at]!),
        ...(doc === undefined ? {} : { doc }),
      };
    });
    return memberDeclarations.length === 0 ? {} : { memberDeclarations };
  };
}
