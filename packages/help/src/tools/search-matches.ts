import type { LexiconMatches } from '../dependency-lexicon.js';
import type { Area } from './area.js';
import type { PublishedMatch } from './published-match.js';

// compass: variance-authority.report.agent-surface

/**
 * What `search` found, before a word of it is written.
 *
 * The text answer is one rendering of this and `--format json` is the other,
 * so the two cannot disagree about a count or a row: both read the same value.
 * What was not determined is absent, never empty. A start point that did not
 * resolve carries `refused` and no sections, because nothing was searched; the
 * loose and described sections are absent when an earlier section answered,
 * because they were not run, and present with a total of zero when they ran and
 * found nothing.
 *
 * Every `total` counts the whole match and every `shown` holds the first few.
 * Only the shown rows are decoded, so a two-letter query that matches a
 * hundred thousand names costs its count and fifteen rows.
 */

/** What a question to `search` says. */
export interface SearchQuestion {
  /**
   * A substring of a name or its documentation, matched case-insensitively; or
   * several words, which also match a name whose own words — split where the
   * case or a digit changes — start with every one of them, and a doc writing them as a phrase (`docsSaying`).
   */
  readonly query: string;
  /** Paths whose imports the answer is confined to. */
  readonly from?: string | readonly string[] | undefined;
  /** Paths whose importers the answer is confined to. */
  readonly to?: string | readonly string[] | undefined;
}

/** A name the source exports without publishing. */
export interface ExportedMatch {
  readonly source: 'exported';
  readonly name: string;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  /** The file shown: the row that ranks it, where the question was found first, then `exportedOrder`; in the described section, the row it is weighed through. */
  readonly at: string;
  readonly line: number;
  /** How many files export it, the one shown included. */
  readonly files: number;
  /**
   * What the shown row's own documentation says of the question, on one line,
   * as `PublishedMatch` says it; absent when that row has none.
   */
  readonly summary?: string;
}

/** A name a file declares at its top level and does not export. */
export interface DeclaredMatch {
  readonly source: 'declared';
  readonly name: string;
  /** The declaration's kind as the parser read it: `function`, `const`, … */
  readonly kind: string;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  readonly at: string;
  readonly line: number;
  /** The sentence of its doc that holds the question, or the doc's first paragraph, on one line; absent when it has no doc. */
  readonly summary?: string;
}

/** A declaration as the source index read it: where its doc is, until a row prints it. */
export type DeclaredRead = DeclaredMatch & {
  readonly doc?: { readonly start: number; readonly end: number };
};

/** A member of a container, or a function another function's body declares. */
export interface HeldMatch {
  readonly source: 'held';
  readonly name: string;
  /** `member`, or the declaration's kind as the parser read it. */
  readonly kind: string;
  /** The container of a member; `a type literal` or `a class` when it has no name. */
  readonly on?: string;
  /** The function that holds it, when that function has a name. */
  readonly holder?: string;
  /** The line that function starts on: present only for a function inside a function. */
  readonly holderLine?: number;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  readonly at: string;
  readonly line: number;
}

/** An import that binds the name asked for to another one. */
export interface AliasMatch {
  readonly source: 'alias';
  /** The name the importing file knows it by, which is the question. */
  readonly local: string;
  /** The export name the binding takes, `default` for a default import. */
  readonly imported: string;
  /** The specifier as the importing file wrote it. */
  readonly specifier: string;
  /** The package of the importing file; absent at the repository root. */
  readonly package?: string;
  readonly at: string;
  readonly line: number;
  readonly type: boolean;
}

/** A file of this repository, described by its name and the doc it opens with. */
export interface FileMatch {
  readonly source: 'file';
  readonly at: string;
  /** The package that holds it; absent at the repository root. */
  readonly package?: string;
  /** The sentence of the doc the file opens with that holds the question, or that doc's first paragraph, on one line; absent when it opens with none. */
  readonly summary?: string;
}

/** A name or a file of this repository a description reached, and which of its words it holds. */
export type DescribedMatch = (PublishedMatch | ExportedMatch | DeclaredMatch | FileMatch) & {
  /** The question's words the name, the file's name or the documentation holds, as the question wrote them. */
  readonly words: readonly string[];
};

export interface Matches<T> {
  readonly total: number;
  readonly shown: readonly T[];
}

/** The closure a start point resolved to, counted. */
export interface SearchArea {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly files: number;
  /** Files the paths themselves named. */
  readonly entries: number;
  /** Files in it whose own imports the scan could not enumerate. */
  readonly unresolved: number;
}

/**
 * One `search` answer, as the text and `--format json` both read it.
 *
 * Sections are present when they ran. `loose` runs only when the exact local
 * sections are empty and no installed name holds the query, and `described`
 * runs beside it. No section runs when `refused` is set.
 */
export interface SearchAnswer {
  /** The query as it was matched: lowercase. */
  readonly query: string;
  /** Absent when no start point was said. */
  readonly area?: SearchArea;
  /** Why the start point was not resolved. When present, nothing was searched. */
  readonly refused?: string;
  readonly published?: Matches<PublishedMatch>;
  readonly exported?: Matches<ExportedMatch>;
  /**
   * Names a file declares and does not export, read off the source index.
   * Absent when no checkout was named or its index could not be read.
   */
  readonly declared?: Matches<DeclaredMatch> & {
    /** Files whose declarations the index holds none of, since none were read: unknown, not empty. */
    readonly unread: readonly string[];
  };
  /**
   * Members and functions inside a function, read off the source index as
   * `declared` is. Beside any other section, only those that are the question,
   * since one that holds its words adds nothing to an answer. Absent when
   * `declared` is.
   */
  readonly held?: Matches<HeldMatch>;
  /** The imports that bind the name as written to another. Absent when the source index could not be read. */
  readonly aliases?: Matches<AliasMatch>;
  /** Recorded test cases whose names hold every word of the question. Absent when no checkout was named. */
  readonly tests?: RecordedTests;
  /** The languages of this workspace whose members were not read, by name, when nothing answered; absent otherwise and when there are none. */
  readonly membersUnread?: readonly string[];
  /**
   * Present only when the exact sections are empty, which is when it runs: the
   * published and exported names first, then the ones a file keeps to itself.
   */
  readonly loose?: Matches<PublishedMatch | ExportedMatch | DeclaredMatch>;
  /**
   * This repository's names and files holding any of the question's words,
   * but a name holding fewer than half the stems that `loose` holds. Present
   * when `loose` ran, which is when it runs;
   * absent too when the question has no word to describe it by.
   */
  readonly described?: Matches<DescribedMatch>;
  /** Installed third-party names available to this workspace or area. */
  readonly thirdParty?: LexiconMatches;
  /** Why the imports within a package were not read for the counts shown; absent when they were, or nothing was counted. */
  readonly importsUnread?: string;
}

/** A test case the last run recorded, by the name its runner gave it. */
export interface TestMatch {
  readonly source: 'test';
  readonly name: string;
  /** The test file that holds it. */
  readonly at: string;
}

/** The recorded cases a question names, and what was read to say so. */
export type RecordedTests = Matches<TestMatch> & {
  /** How many cases the records read held, counting a case once for each suite that ran it. */
  readonly read: number;
  /** The declared suites whose cases were not read. */
  readonly unread: readonly string[];
};

/** The answer, and the resolved area the text renders its header from. */
export interface Searched {
  readonly answer: SearchAnswer;
  readonly area: Area | undefined;
  /** The entries and barrels that publish the rows counted; absent when none was. */
  readonly publishing?: ReadonlySet<string>;
}
