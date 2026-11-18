// compass: variance-authority.reach.source-index
import type { FileSize, SourceScope } from './source-scope.js';
import type { ChainViolation, RuleFile, Violation } from './restrictions.js';

/** Source questions answered over retained native columns and adjacency. */
export interface NativeSelectionCoverage {
  sourceFiles(): string[];
  sourceProblems(dirs: readonly string[]): readonly { readonly file: string; readonly unknown?: string }[];
  coverage(from?: string, patterns?: readonly string[]): SourceScope & { readonly sizes: readonly FileSize[] };
  sizes(files: readonly string[]): readonly FileSize[];
  restrictions(files: readonly RuleFile[], seeds: readonly string[]): { readonly imports: readonly Violation[]; readonly chains: readonly ChainViolation[] };
}
