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

  /**
   * The same reading in the arrangement it was read in, document order.
   *
   * The fields above are what the subject *says*; this is where it said it. A
   * bag of words can answer that a subject holds `carrier` and holds
   * `contract`, and can never answer that the second sits beneath the first —
   * which is the question somebody arriving at a screen actually has. Both come
   * out of one walk over one tree, because two walks eventually disagree about
   * what was there.
   *
   * Absent on a subject with no snapshot. A dialog with nothing on it and a run
   * that never looked are different sentences here too.
   */
  readonly landmarks?: readonly Landmark[];

  /** How many landmarks the cap left out. */
  readonly elidedLandmarks?: number;
}

/**
 * One thing on a subject a person could point at, where the run saw it.
 *
 * A node earns a place here by bearing a role, an accessible name, or words of
 * its own. Everything else is scaffolding, and scaffolding is what makes a real
 * application's tree six hundred deep: the wrapper a layout needed, the div a
 * styling library emitted, the provider a context consumer sits under. Nothing
 * here recognises any of them, and nothing here needs to — the test is what the
 * node *says*, so a screen written with an era's worth of higher-order
 * components reduces to the same landmarks as the same screen written flat.
 */
export interface Landmark {
  readonly role?: string;
  readonly name?: string;

  /** The words directly inside it, and only those. */
  readonly text?: string;

  /** Index of the nearest enclosing landmark. Absent on a top-level one. */
  readonly within?: number;

  /**
   * `[x, y, width, height]` in layout pixels.
   *
   * Absent, never zeroed, exactly as `rect` is — and the field a reader must
   * consult before it uses the word *beneath*. With layout, beneath is read off
   * two rectangles and is an observation. Without it, the best a reader can do
   * is document order, which agrees with the screen often enough to be
   * dangerous and not often enough to be relied on.
   */
  readonly box?: readonly [number, number, number, number];

  /** Where the element was written, when the project installed the plugin. */
  readonly file?: string;
  readonly line?: number;

  /**
   * The innermost component that owns it, off the fiber's owner chain.
   *
   * The line an element was written on needs the JSX-source plugin, which a
   * production build strips — and a built Storybook is a production build, so
   * `file` and `line` are absent on exactly the runs that matter most. The
   * owner chain survives that build. This is the name that carries a place
   * through it: not the line the element sits on, but the component whose
   * source you would open to find it, joined to a path through
   * {@link LexiconReport.declaredIn}.
   */
  readonly component?: string;

  /** The component whose JSX created it. The unit somebody owns. */
  readonly createdBy?: string;

  /** A test handle, when one was set. The one name a suite chose deliberately. */
  readonly handle?: string;
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

  /**
   * Component → the files declaring it, written once for the whole run.
   *
   * A landmark carries the component that owns it and not a path, because the
   * same component owns thousands of them and the path is the longer half. The
   * join is here, one row per component in the suite, so a reader asked *where
   * does this live* can answer with a file on a run whose build stripped the
   * JSX source — which is every built Storybook. Absent when no source index
   * was read.
   */
  readonly declaredIn?: Readonly<Record<string, readonly string[]>>;
}
