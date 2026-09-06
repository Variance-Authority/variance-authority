/**
 * Every name the run held for each subject, written down so a reader can ask for one.
 *
 * The report's other sections answer questions an agent already knows how to
 * phrase: *this subject*, *this component*, *this finding*. This section is for
 * the question that comes before those — *the thing I can only describe* — and it
 * exists because nothing the question would be asked against survives the run.
 * The snapshots are gone when the worker returns, the execution journal is a file
 * on the run host, and the readers — the MCP tools, the pull-request comment —
 * sit on machines that have neither. So the run writes the names down, per
 * subject and per field, and the reader tokenises them.
 *
 * ## What a field is
 *
 * Every field is a vocabulary the run *derived*: the component names off the
 * fiber, the roles and accessible names off the accessibility tree, the visible
 * text off the DOM, the tokens off the cascade, the files off the source index,
 * the regions off the journal. Nothing in it was declared for the purpose of
 * being found. That is the whole "semantic" layer: the run already recorded that
 * a `Toggle` is a `checkbox` named `Mark "Buy milk" as done` in
 * `src/ds/components.tsx`, so a query in any of those four vocabularies lands on
 * the same subject with no thesaurus between them.
 *
 * ## Why raw values and not tokens
 *
 * The values are kept as the run read them — `TodoFooter`, `Clear completed`,
 * `--va-space-2` — and never pre-split. A hit has to print the value it matched
 * so the reader can see the fact under the rank, and a value split at run time
 * would be a promise about a tokeniser the reader cannot see. Splitting is the
 * reader's, and it is one fixed rule applied to both sides.
 */

/** The vocabularies a subject is indexed under, in the order they earn their weight. */
export type LexiconField =
  | 'example'
  | 'names'
  | 'text'
  | 'components'
  | 'createdBy'
  | 'regions'
  | 'files'
  | 'roles'
  | 'tokens';

/** One subject's names, per field. */
export interface SubjectLexicon {
  readonly subject: string;

  /**
   * Attributed component boundaries in the subject.
   *
   * The one number a rank is allowed to read: a smaller composition is the
   * narrower example of whatever both hold, so it leads when the match is equal.
   * Never a term count — three chips in one list is a fact about a list.
   */
  readonly boundaries: number;

  /**
   * Distinct values per field, code-unit sorted. A field the run read and found
   * empty is absent; a field the run did not read is absent from
   * {@link LexiconReport.fields}, and the two are different sentences.
   */
  readonly terms: Partial<Record<LexiconField, readonly string[]>>;

  /**
   * How many distinct values a field's cap left out, per field. Present only
   * where a cap cut, so a subject that fit is one that fit.
   */
  readonly elided?: Partial<Record<LexiconField, number>>;
}

/**
 * The run's lexicon.
 *
 * Absent from a report whose collection produced no semantic snapshots, for the
 * same reason `composition` is: a raster-only tier holds no names to index, and
 * an empty lexicon would answer *nothing matches* where the truth is *nothing was
 * read*.
 */
export interface LexiconReport {
  readonly version: 1;

  /**
   * The fields this run read. A field missing here was not looked at — no
   * journal was open, so no `regions`; no source index was built, so no `files`
   * — and a reader has to say so rather than report no match in it.
   */
  readonly fields: readonly LexiconField[];

  /** One entry per subject that supplied a snapshot, in plan order. */
  readonly subjects: readonly SubjectLexicon[];
}
