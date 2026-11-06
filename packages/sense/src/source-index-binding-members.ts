// compass: variance-authority.reach.source-index

import { rangeOf, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { BindingMember } from './cache.js';

/**
 * The binding-member columns of a source-index generation: per parse, the names
 * the file reads off a value inside a module, each with the index of the
 * request the value is read through, the export it is or is read off, and the
 * names read off that export to reach it, in a second offset list per read.
 *
 * One offset list, because the module reader records the list only when it is
 * not empty, so the empty range and the absent field are the same fact.
 */

/**
 * Validate and open the columns. The reader answers one parse row as the field
 * to spread into it, and `requests` is that row's request count.
 */
export function openBindingMembers(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number, requests: number) => { readonly bindingMembers?: readonly BindingMember[] } {
  const reject = (): never => { throw opened.reject(); };
  const offsets = opened.u32('parses.binding-members');
  const request = opened.u32('binding-members.request');
  const binding = opened.u32('binding-members.binding');
  const name = opened.u32('binding-members.name');
  const line = opened.u32('binding-members.line');
  const withinOffsets = opened.u32('binding-members.within');
  const withinName = opened.u32('binding-within.name');
  validateOffsets(offsets, name.length, parseCount, reject);
  validateOffsets(withinOffsets, withinName.length, name.length, reject);
  if (request.length !== name.length || binding.length !== name.length || line.length !== name.length) reject();

  return (row, requests) => {
    const bindingMembers = rangeOf(offsets, row, reject).map((at): BindingMember => {
      if (request[at]! >= requests) reject();
      const within = rangeOf(withinOffsets, at, reject).map((one) => text(withinName[one]!));
      return {
        request: request[at]!,
        binding: text(binding[at]!),
        ...(within.length === 0 ? {} : { within }),
        name: text(name[at]!),
        line: line[at]!,
      };
    });
    return bindingMembers.length === 0 ? {} : { bindingMembers };
  };
}
