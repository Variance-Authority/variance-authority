import { rangeOf, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { MemberUse } from './cache.js';

/**
 * The member-use columns of a source-index generation: per parse, every line
 * that reads, writes or destructures a member through a value whose type the
 * file writes, with the type's name as the file writes it.
 *
 * One offset list, because the module reader records the list only when it is
 * not empty, so the empty range and the absent field are the same fact.
 */

/** Validate and open the columns. The reader answers one parse row as the field to spread into it. */
export function openMemberUses(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number) => { readonly memberUses?: readonly MemberUse[] } {
  const reject = (): never => { throw opened.reject(); };
  const offsets = opened.u32('parses.member-uses');
  const name = opened.u32('member-uses.name');
  const line = opened.u32('member-uses.line');
  const of = opened.u32('member-uses.of');
  const how = opened.u32('member-uses.how');
  validateOffsets(offsets, name.length, parseCount, reject);
  if (line.length !== name.length || of.length !== name.length || how.length !== name.length) reject();

  return (row) => {
    const memberUses = rangeOf(offsets, row, reject).map((at): MemberUse => ({
      name: text(name[at]!),
      line: line[at]!,
      of: text(of[at]!),
      how: text(how[at]!) as MemberUse['how'],
    }));
    return memberUses.length === 0 ? {} : { memberUses };
  };
}
