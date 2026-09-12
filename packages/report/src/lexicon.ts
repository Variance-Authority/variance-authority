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
 *
 * Values are also deduplicated, code-unit sorted, and capped — `LEXICON_CAP`
 * distinct values per field, in
 * [`core/attribute/lexicon.ts`](../../core/src/attribute/lexicon.ts) where the
 * fold is. What a cap cut is counted in {@link SubjectLexicon.elided}, because a
 * cap that says nothing reads as coverage. Digests never enter: a text the
 * policy declared volatile arrives as `v1:…`, and a reader matching on it would
 * be matching a coordinate rather than a word.
 *
 * ## Where it is kept, and what it outlives
 *
 * The report carries it, and the report is about one run. The lexicon is not:
 * the names a suite holds change when the suite changes, which is rarely, and
 * the question *which subject do I mean* is asked far more often than a run
 * happens. So it is also the one section copied verbatim into the **suite
 * index** ([`suite-index.ts`](./suite-index.ts)) — bytes, addressed by the
 * commit they were written at, small enough for a cache to carry and stable
 * enough that two machines composing the same suite write the same file.
 *
 * That is what makes a reader possible on a machine that never ran anything: a
 * checkout with no report, a pull-request comment, an agent asking about the
 * mainline suite before it has touched the branch. The transport is somebody
 * else's — a directory, an action cache, a bucket, a deployment — and this
 * module's only obligation to it is that equal facts encode to equal bytes.
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
   * where a cap cut, so a subject that fit is one that fit — and a reader that
   * finds nothing can tell *this subject holds no such name* from *this subject
   * holds more names than were kept*.
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
   *
   * This is the field that makes a lexicon from elsewhere safe to answer over.
   * Two runs of one suite may read different fields: the run that had a journal
   * indexed `regions` and the one that did not holds the same subjects with one
   * vocabulary missing. A reader comparing the two reports which fields the
   * lexicon in its hands was written with, never which fields it wishes it had.
   */
  readonly fields: readonly LexiconField[];

  /** One entry per subject that supplied a snapshot, in plan order. */
  readonly subjects: readonly SubjectLexicon[];
}
