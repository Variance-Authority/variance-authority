/** A predicate evaluated against the native source columns. */
export interface NamesOperand {
  readonly kind: 'declares' | 'imports';
  readonly pattern?: string;
  readonly specifier?: string;
  readonly name?: string;
}

/** Matching declaration or import evidence; unmatched source rows stay native. */
export interface NameEvidence {
  readonly line: number;
  readonly name?: string;
  readonly from?: string;
  readonly local?: string;
  readonly through?: string;
}

export interface NamesGroup {
  readonly files: readonly { readonly file: string; readonly evidence: readonly NameEvidence[] }[];
}

export interface NamesAnswer {
  readonly unread: number;
  readonly groups: readonly NamesGroup[];
}

/** All predicates in one discovery question share one native source generation and pass. */
export interface SourceNames {
  query(operands: readonly NamesOperand[]): NamesAnswer;
}
