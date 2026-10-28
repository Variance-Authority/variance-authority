import {
  NONE,
  rangeOf,
  sameLength,
  validateOffsets,
  type OpenSegment,
} from '@variance-authority/core/segment';
import type { SourceSymbol, SourceSymbolReach, TextSpan } from './harvest.js';

/** The reaches `symbols.reach` stores, from 1; 0 is none. `REACHES` in `native/src/harvest.rs`. */
const REACHES: readonly SourceSymbolReach[] = ['file', 'module', 'underscore', 'all'];

export interface HarvestReader {
  symbols(row: number): readonly SourceSymbol[];
  exportSignature(row: number): TextSpan | undefined;
  exportDoc(row: number): TextSpan | undefined;
  /** The module's own doc comment, inside its marks, of one parse row. */
  moduleDoc(row: number): TextSpan | undefined;
}

/** Validate and open the declaration columns of one generation. */
export function openHarvest(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
  exportCount: number,
): HarvestReader {
  const reject = (): never => { throw opened.reject(); };
  const parseSymbols = opened.u32('parses.symbols');
  const symbolName = opened.u32('symbols.name');
  const symbolKind = opened.u32('symbols.kind');
  const symbolLine = opened.u32('symbols.line');
  const signatureStart = opened.u32('symbols.signature-start');
  const signatureEnd = opened.u32('symbols.signature-end');
  const docStart = opened.u32('symbols.doc-start');
  const docEnd = opened.u32('symbols.doc-end');
  const symbolReach = opened.u8('symbols.reach');
  const exportSignatureStart = opened.u32('exports.signature-start');
  const exportSignatureEnd = opened.u32('exports.signature-end');
  const exportDocStart = opened.u32('exports.doc-start');
  const exportDocEnd = opened.u32('exports.doc-end');
  const moduleDocStart = opened.u32('parses.doc-start');
  const moduleDocEnd = opened.u32('parses.doc-end');

  validateOffsets(parseSymbols, symbolName.length, parseCount, reject);
  sameLength(symbolName.length, [symbolKind, symbolLine, signatureStart, signatureEnd, docStart, docEnd, symbolReach], reject);
  sameLength(exportCount, [exportSignatureStart, exportSignatureEnd, exportDocStart, exportDocEnd], reject);
  sameLength(parseCount, [moduleDocStart, moduleDocEnd], reject);

  const span = (starts: Uint32Array, ends: Uint32Array, row: number): TextSpan | undefined => {
    const start = starts[row];
    const end = ends[row];
    if (start === NONE && end === NONE) return undefined;
    if (start === undefined || end === undefined || start === NONE || end === NONE || end < start) {
      throw opened.reject();
    }
    return { start, end };
  };

  return {
    symbols: (row) => rangeOf(parseSymbols, row, reject).map((at) => {
      const signature = span(signatureStart, signatureEnd, at);
      const doc = span(docStart, docEnd, at);
      const code = symbolReach[at]!;
      const reach = code === 0 ? undefined : REACHES[code - 1];
      if (code !== 0 && reach === undefined) throw opened.reject();
      return {
        name: text(symbolName[at]!),
        kind: text(symbolKind[at]!) as SourceSymbol['kind'],
        line: symbolLine[at]!,
        ...(signature === undefined ? {} : { signature }),
        ...(doc === undefined ? {} : { doc }),
        ...(reach === undefined ? {} : { reach }),
      };
    }),
    exportSignature: (row) => span(exportSignatureStart, exportSignatureEnd, row),
    exportDoc: (row) => span(exportDocStart, exportDocEnd, row),
    moduleDoc: (row) => span(moduleDocStart, moduleDocEnd, row),
  };
}
