import {
  NONE,
  rangeOf,
  sameLength,
  validateOffsets,
  type Column,
  type OpenSegment,
} from '@variance-authority/core/segment';
import type { Parsed, ParseKey } from './cache.js';
import type { SourceSymbol, TextSpan } from './harvest.js';

type ParseRows = readonly (readonly [ParseKey, Parsed])[];

function optional(value: number | undefined): number {
  return value ?? NONE;
}

/** The declaration columns added to a source-index generation. */
export function encodeHarvest(
  parses: ParseRows,
  id: (value: string) => number,
): Readonly<Record<string, Column>> {
  const parseSymbols: number[] = [];
  const symbolName: number[] = [];
  const symbolKind: number[] = [];
  const symbolLine: number[] = [];
  const signatureStart: number[] = [];
  const signatureEnd: number[] = [];
  const docStart: number[] = [];
  const docEnd: number[] = [];
  const exportSignatureStart: number[] = [];
  const exportSignatureEnd: number[] = [];
  const exportDocStart: number[] = [];
  const exportDocEnd: number[] = [];

  for (const [, parsed] of parses) {
    parseSymbols.push(symbolName.length);
    for (const symbol of parsed.symbols ?? []) {
      symbolName.push(id(symbol.name));
      symbolKind.push(id(symbol.kind));
      symbolLine.push(symbol.line);
      signatureStart.push(optional(symbol.signature?.start));
      signatureEnd.push(optional(symbol.signature?.end));
      docStart.push(optional(symbol.doc?.start));
      docEnd.push(optional(symbol.doc?.end));
    }
    for (const exported of parsed.exports ?? []) {
      exportSignatureStart.push(optional(exported.signature?.start));
      exportSignatureEnd.push(optional(exported.signature?.end));
      exportDocStart.push(optional(exported.doc?.start));
      exportDocEnd.push(optional(exported.doc?.end));
    }
  }
  parseSymbols.push(symbolName.length);

  return {
    'parses.symbols': Uint32Array.from(parseSymbols),
    'symbols.name': Uint32Array.from(symbolName),
    'symbols.kind': Uint32Array.from(symbolKind),
    'symbols.line': Uint32Array.from(symbolLine),
    'symbols.signature-start': Uint32Array.from(signatureStart),
    'symbols.signature-end': Uint32Array.from(signatureEnd),
    'symbols.doc-start': Uint32Array.from(docStart),
    'symbols.doc-end': Uint32Array.from(docEnd),
    'exports.signature-start': Uint32Array.from(exportSignatureStart),
    'exports.signature-end': Uint32Array.from(exportSignatureEnd),
    'exports.doc-start': Uint32Array.from(exportDocStart),
    'exports.doc-end': Uint32Array.from(exportDocEnd),
  };
}

export function addHarvestStrings(parsed: Parsed, values: Set<string>): void {
  for (const symbol of parsed.symbols ?? []) {
    values.add(symbol.name);
    values.add(symbol.kind);
  }
}

export interface HarvestReader {
  symbols(row: number): readonly SourceSymbol[];
  exportSignature(row: number): TextSpan | undefined;
  exportDoc(row: number): TextSpan | undefined;
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
  const exportSignatureStart = opened.u32('exports.signature-start');
  const exportSignatureEnd = opened.u32('exports.signature-end');
  const exportDocStart = opened.u32('exports.doc-start');
  const exportDocEnd = opened.u32('exports.doc-end');

  validateOffsets(parseSymbols, symbolName.length, parseCount, reject);
  sameLength(symbolName.length, [symbolKind, symbolLine, signatureStart, signatureEnd, docStart, docEnd], reject);
  sameLength(exportCount, [exportSignatureStart, exportSignatureEnd, exportDocStart, exportDocEnd], reject);

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
      return {
        name: text(symbolName[at]!),
        kind: text(symbolKind[at]!) as SourceSymbol['kind'],
        line: symbolLine[at]!,
        ...(signature === undefined ? {} : { signature }),
        ...(doc === undefined ? {} : { doc }),
      };
    }),
    exportSignature: (row) => span(exportSignatureStart, exportSignatureEnd, row),
    exportDoc: (row) => span(exportDocStart, exportDocEnd, row),
  };
}
