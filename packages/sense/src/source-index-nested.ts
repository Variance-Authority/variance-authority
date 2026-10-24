// compass: variance-authority.reach.source-index

import { NONE, rangeOf, sameLength, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { NestedDeclaration } from './cache.js';
import type { TextSpan } from './harvest.js';

/**
 * The nested columns of a source-index generation: per parse, every function
 * a function's body declares, with the function that holds it. Apart from
 * `symbols`, so a reader of a file's top level never meets one.
 *
 * One offset list, because the module reader records the list only when it is
 * not empty, so the empty range and the absent field are the same fact.
 */

/** Validate and open the columns. The reader answers one parse row as the field to spread into it. */
export function openNested(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number) => { readonly nested?: readonly NestedDeclaration[] } {
  const reject = (): never => { throw opened.reject(); };
  const offsets = opened.u32('parses.nested');
  const name = opened.u32('nested.name');
  const kind = opened.u32('nested.kind');
  const line = opened.u32('nested.line');
  const signatureStart = opened.u32('nested.signature-start');
  const signatureEnd = opened.u32('nested.signature-end');
  const docStart = opened.u32('nested.doc-start');
  const docEnd = opened.u32('nested.doc-end');
  const holder = opened.u32('nested.holder');
  const holderLine = opened.u32('nested.holder-line');
  validateOffsets(offsets, name.length, parseCount, reject);
  sameLength(name.length, [kind, line, signatureStart, signatureEnd, docStart, docEnd, holder, holderLine], reject);

  const span = (starts: Uint32Array, ends: Uint32Array, at: number): TextSpan | undefined => {
    const start = starts[at]!;
    const end = ends[at]!;
    if (start === NONE && end === NONE) return undefined;
    if (start === NONE || end === NONE || end < start) reject();
    return { start, end };
  };

  return (row) => {
    const nested = rangeOf(offsets, row, reject).map((at): NestedDeclaration => {
      const doc = span(docStart, docEnd, at);
      return {
        name: text(name[at]!),
        kind: text(kind[at]!),
        line: line[at]!,
        signature: span(signatureStart, signatureEnd, at) ?? reject(),
        ...(doc === undefined ? {} : { doc }),
        ...(holder[at] === NONE ? {} : { holder: text(holder[at]!) }),
        holderLine: holderLine[at]!,
      };
    });
    return nested.length === 0 ? {} : { nested };
  };
}
