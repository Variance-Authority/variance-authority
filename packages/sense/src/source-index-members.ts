import { rangeOf, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { Member } from './cache.js';

/**
 * The member columns of a source-index generation: per parse, the names the
 * file reads off a namespace import or an `import()`, each with the index of
 * the request it reads through.
 *
 * One offset list, because a parse with no member reads is a parse whose
 * `members` is absent: the module reader records the list only when it is not
 * empty, so the empty range and the absent field are the same fact.
 */

/**
 * Validate and open the member columns. The reader answers one parse row as the
 * field to spread into it, and `requests` is that row's request count.
 */
export function openMembers(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number, requests: number) => { readonly members?: readonly Member[] } {
  const reject = (): never => { throw opened.reject(); };
  const parseMembers = opened.u32('parses.members');
  const request = opened.u32('members.request');
  const name = opened.u32('members.name');
  const line = opened.u32('members.line');
  validateOffsets(parseMembers, name.length, parseCount, reject);
  if (request.length !== name.length || line.length !== name.length) reject();

  return (row, requests) => {
    const members = rangeOf(parseMembers, row, reject).map((at): Member => {
      if (request[at]! >= requests) reject();
      return { request: request[at]!, name: text(name[at]!), line: line[at]! };
    });
    return members.length === 0 ? {} : { members };
  };
}
