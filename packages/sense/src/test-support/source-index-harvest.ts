import {
  NONE,
  rangeOf,
  sameLength,
  validateOffsets,
  type OpenSegment,
} from '@variance-authority/core/segment';
import type { SourceSymbol, SourceSymbolReach, TextSpan } from '../harvest.js';

/** The reaches `symbols.reach` stores, from 1; 0 is none. `REACHES` in `native/src/harvest.rs`. */
const REACHES: readonly SourceSymbolReach[] = ['file', 'module', 'underscore', 'all'];

/** A span's start, end and text columns. */
export type SpanColumns = readonly [starts: Uint32Array, ends: Uint32Array, texts: Uint32Array];

/**
 * The span three columns hold at `at`, with the text the index kept of it in
 * its text heap: absent when both ends are, and `reject`ed when one is or it
 * runs backwards.
 */
export function spanAt([starts, ends, texts]: SpanColumns, at: number, kept: (value: number) => string | undefined, reject: () => never): TextSpan | undefined {
  const start = starts[at];
  const end = ends[at];
  const id = texts[at];
  if (start === NONE && end === NONE) return undefined;
  if (start === undefined || end === undefined || id === undefined || start === NONE || end === NONE || end < start) reject();
  const text = kept(id);
  return text === undefined ? { start, end } : { start, end, text };
}

/** Open a span's three columns, `<name>-start`, `-end` and `-text`. */
export function spanColumns(opened: OpenSegment, name: string): SpanColumns {
  return [opened.u32(`${name}-start`), opened.u32(`${name}-end`), opened.u32(`${name}-text`)];
}

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
  kept: (value: number) => string | undefined,
  parseCount: number,
  exportCount: number,
): HarvestReader {
  const reject = (): never => { throw opened.reject(); };
  const parseSymbols = opened.u32('parses.symbols');
  const symbolName = opened.u32('symbols.name');
  const symbolKind = opened.u32('symbols.kind');
  const symbolLine = opened.u32('symbols.line');
  const symbolSignature = spanColumns(opened, 'symbols.signature');
  const symbolDoc = spanColumns(opened, 'symbols.doc');
  const symbolReach = opened.u8('symbols.reach');
  const exportSignature = spanColumns(opened, 'exports.signature');
  const exportDoc = spanColumns(opened, 'exports.doc');
  const moduleDoc = spanColumns(opened, 'parses.doc');

  validateOffsets(parseSymbols, symbolName.length, parseCount, reject);
  sameLength(symbolName.length, [symbolKind, symbolLine, ...symbolSignature, ...symbolDoc, symbolReach], reject);
  sameLength(exportCount, [...exportSignature, ...exportDoc], reject);
  sameLength(parseCount, [...moduleDoc], reject);

  const span = (columns: SpanColumns, row: number): TextSpan | undefined => spanAt(columns, row, kept, reject);

  return {
    symbols: (row) => rangeOf(parseSymbols, row, reject).map((at) => {
      const signature = span(symbolSignature, at);
      const doc = span(symbolDoc, at);
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
    exportSignature: (row) => span(exportSignature, row),
    exportDoc: (row) => span(exportDoc, row),
    moduleDoc: (row) => span(moduleDoc, row),
  };
}
