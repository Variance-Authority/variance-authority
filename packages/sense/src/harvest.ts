/**
 * The top-level declarations a module reader harvests, as the native reader
 * (`native/src/harvest.rs`) hands them over.
 */

/** A source span in the UTF-16 offsets JavaScript strings use. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export type SourceSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'namespace'
  | 'var'
  | 'let'
  | 'const'
  | 'using'
  | 'await using'
  | 'object';

/** One top-level declaration, reduced while the parser still holds its AST. */
export interface SourceSymbol {
  readonly name: string;
  readonly kind: SourceSymbolKind;
  readonly line: number;
  readonly signature?: TextSpan;
  readonly doc?: TextSpan;
}
