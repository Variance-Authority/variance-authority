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
  | 'object'
  // The other languages' readers.
  | 'struct'
  | 'union'
  | 'trait'
  | 'static'
  | 'module'
  | 'macro'
  | 'record'
  | 'annotation'
  | 'protocol'
  | 'actor'
  | 'property'
  | 'variable';

/**
 * Who can name a declaration when no export of its file binds it, as the reader
 * of its language knows: its file alone (an ES module, a Swift or Kotlin
 * `private`), its module and the modules inside it (a Rust item that is not
 * `pub`), or any module that imports it by name, kept out of `from … import *`
 * by a leading underscore or by `__all__` (Python). Absent when the reader
 * cannot tell.
 */
export type SourceSymbolReach = 'file' | 'module' | 'underscore' | 'all';

/** One top-level declaration, reduced while the parser still holds its AST. */
export interface SourceSymbol {
  readonly name: string;
  readonly kind: SourceSymbolKind;
  readonly line: number;
  readonly signature?: TextSpan;
  readonly doc?: TextSpan;
  readonly reach?: SourceSymbolReach;
}
