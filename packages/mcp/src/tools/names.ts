import type { NamesAnswer, NamesOperand } from '@variance-authority/sense';

/** All predicates in one discovery question share one native source generation and pass. */
export interface SourceNames {
  query(operands: readonly NamesOperand[]): NamesAnswer;
}
