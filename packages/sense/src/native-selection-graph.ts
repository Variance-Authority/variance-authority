/** Native selection questions; source columns, provenance and graph state stay native. */
// compass: variance-authority.reach.relations
import type { RelationQuestions } from '@variance-authority/core/relate';
import type { OpenedIndex } from './help-reading.js';
import type { NativeSelectionCoverage } from './native-selection-coverage.js';

export interface NativeSelectionGraph extends RelationQuestions, NativeSelectionCoverage {
  sources(files: readonly string[]): readonly boolean[];
  names(files: readonly string[]): readonly (string | null)[];
}
export interface NativeSelectionGraphOptions {
  readonly root: string;
  readonly dirs: readonly string[];
  readonly before: readonly string[];
  readonly code: readonly string[];
  readonly builtins: readonly string[];
  readonly tsconfig?: string | false;
  readonly raw?: boolean;
  readonly taints: readonly { readonly file: string; readonly plus: readonly string[]; readonly minus: readonly string[] }[];
  readonly depends: readonly { readonly from: string; readonly to: string }[];
}
export interface NativeSelectionGraphs {
  selectionGraphOf(index: OpenedIndex, options: NativeSelectionGraphOptions): NativeSelectionGraph | null;
}
