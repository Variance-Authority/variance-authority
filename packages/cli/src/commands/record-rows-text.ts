// compass: variance-authority.reach
/**
 * The text a record's rows of each file were cut from, as its digest: the text
 * the record's lines of that file are numbered in. A review asks whether the
 * file ran as the tree holds it, and a count asks which edits lie between the
 * rows and the checkout; both ask here.
 */

import {
  askCoverageFile,
  casesCutApart,
  findModules,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';

/** The digest a file's rows were cut from, or why it is not known. */
export type RowsText = string | { readonly unknown: string };

/**
 * Per file of `files`, the digest of the text the rows of the record at
 * `coverageFile` were cut from. A file the record holds no row of is absent. A
 * file is not known when `index`, the case index read from the record, cut its
 * cases at other text than its rows ({@link casesCutApart}), or when its rows
 * were cut from more than one text. Throws when the record does not read.
 */
export function rowsText(coverageFile: string, files: Iterable<string>, index: ExecutionIndex): ReadonlyMap<string, RowsText> {
  const asked = new Set(files);
  if (asked.size === 0) return new Map();
  const apart = casesCutApart(coverageFile, index.modules.filter((module) => asked.has(module.file)));
  return askCoverageFile(coverageFile, (coverage) => {
    const texts = new Map<string, RowsText>();
    for (const file of asked) {
      const held = new Set(findModules(coverage, file).map((row) => coverage.string(coverage.moduleSource.at(row))));
      if (held.size === 0) continue;
      if (apart.has(file)) texts.set(file, { unknown: `the record's case index of ${file} was cut from another text than its rows` });
      else if (held.size > 1) texts.set(file, { unknown: `the record holds rows of ${file} from more than one text` });
      else texts.set(file, [...held][0]!);
    }
    return texts;
  });
}
