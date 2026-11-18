import { mergeSourceIndexes, type SourceIndex } from '@variance-authority/core/attribute';
import { indexDeclarations } from '@variance-authority/sense';

/** Component attribution for supplied fixture text; production reads the native publication. */
export function indexOf(files: ReadonlyMap<string, string>): SourceIndex {
  return mergeSourceIndexes([...files].map(([file, contents]) => indexDeclarations(file, contents)));
}
