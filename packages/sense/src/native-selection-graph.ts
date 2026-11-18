/** Native selection questions; source columns, provenance and graph state stay native. */
// compass: variance-authority.reach.relations
import type { RelationQuestions } from '@variance-authority/core/relate';
import type { NativeSelectionCoverage } from './native-selection-coverage.js';

/** Selection graph questions joined to native source membership, names and recorded coverage. */
export interface NativeSelectionGraph extends RelationQuestions, NativeSelectionCoverage {
  sources(files: readonly string[]): readonly boolean[];
  names(files: readonly string[]): readonly (string | null)[];
}
