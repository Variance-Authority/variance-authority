import { declaredLine } from './declared.js';
import { byPublishedPath, plural } from './format.js';
import type { PublishedMatch } from './published-match.js';
import type { DeclaredMatch, DescribedMatch, ExportedMatch, FileMatch, RecordedTests, TestMatch } from './search-matches.js';

/*
 * The rows of a `docs_search` answer, one line to each match, and the note on
 * the recorded cases left unread; `search.ts` puts them under their heads.
 */

/** Whether a row of any list is a published one, asked by its specifier. */
export const isPublished = (row: { readonly at: string }): row is PublishedMatch => (row as { readonly source?: string }).source === 'published';

/**
 * Who imports a published match, each count saying what it counts: the places
 * and the packages they sit in, as `uses` counts them; or, given without the
 * Help value, the imports from other packages by a published specifier.
 */
function importedLine(match: PublishedMatch): string {
  const { importedIn } = match;
  if (importedIn !== undefined) {
    return importedIn.places === 0 ? 'imported nowhere' : `imported in ${plural(importedIn.places, 'place')} in ${plural(importedIn.packages, 'package')}`;
  }
  return byPublishedPath(match.otherImports, match.otherPackages);
}

/** One published match: where it is published, what it is, who imports it, and the sentence of its doc that holds the question. */
export function publishedLine(match: PublishedMatch): string {
  const { inArea } = match;
  const said = match.summary ?? 'UNDOCUMENTED';
  if (inArea === undefined) return `${match.specifier} · ${match.name} [${match.kind}] ${importedLine(match)} — ${said}`;
  const distances = inArea.filesByDistance.map(([at, files]) => `${at}: ${files}`).join(', ');
  return (
    `${match.specifier} · ${match.name} [${match.kind}] ${plural(inArea.files, 'file')}, ${plural(inArea.imports, 'import')} in this area ` +
    `(files by distance: ${distances}); across the repository ${importedLine(match)} — ${said}`
  );
}

/** One exported match: the name, who holds it, and the file and line to open. */
export function exportedLine(match: ExportedMatch): string {
  const door = match.exportedFrom;
  const from = door === undefined ? '' : ` · exported from ${door.at}${door.line === undefined ? '' : `:${door.line}`}`;
  const rest = match.files - 1;
  const more = rest === 0 ? '' : ` (+${rest} more ${rest === 1 ? 'file' : 'files'})`;
  const said = match.summary === undefined ? '' : ` — ${match.summary}`;
  return `${match.name} — ${match.package ?? 'the repository'} · ${match.at}:${match.line}${from}${more}${said}`;
}

/** One described file: the path, who holds it, and what the doc it opens with says first. */
function fileLine(match: FileMatch): string {
  return `${match.at} [file] — ${match.package ?? 'the repository'}${match.summary === undefined ? '' : ` — ${match.summary}`}`;
}

/** One recorded case: the name it ran under and the test file that holds it. */
export const testLine = (match: TestMatch): string => `${match.name} [test] — ${match.at}`;

/**
 * What was left unread of the recorded cases, one line to each reason, and only
 * when the repository answered with no row: a row found answers the question,
 * and a suite left unread can change the conclusion only of an answer that
 * found none. An unnamed suite keeps its own line, so its reason is never
 * said of the named ones.
 */
export function casesUnder(tests: RecordedTests | undefined, ownFound: boolean): readonly string[] {
  if (tests === undefined || ownFound) return [];
  const suitesBy = new Map<string, { readonly why: string; readonly suites: string[] }>();
  for (const { suite, why } of tests.unread) {
    const key = JSON.stringify([suite === undefined, why]);
    const line = suitesBy.get(key) ?? { why, suites: [] };
    if (suite !== undefined) line.suites.push(`\`${suite}\``);
    suitesBy.set(key, line);
  }
  const left = [...suitesBy.values()].map(({ why, suites }) => `No recorded case${suites.length === 0 ? '' : ` of ${suites.join(', ')}`} was read: ${why}.`);
  return left.length === 0 ? [] : ['', ...left];
}

export const matchLine = (match: PublishedMatch | ExportedMatch | DeclaredMatch): string =>
  match.source === 'published' ? publishedLine(match) : match.source === 'exported' ? exportedLine(match) : declaredLine(match);

export const describedRow = (match: DescribedMatch): string =>
  `${match.source === 'file' ? fileLine(match) : matchLine(match)} [holds: ${match.words.join(', ')}]`;
