// compass: variance-authority/runtime/attention
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';

/** What names one case: its id, title or a part of the title, its file, or both. */
export interface CaseQuestion {
  readonly test?: string;
  readonly file?: string;
  readonly execution: ExecutionIndex;
}

/**
 * How many recorded ids a refusal shows.
 *
 * Enough for a reader to see the shape their own id should have had, and few
 * enough that an index of four thousand cases does not answer with four
 * thousand lines.
 */
const AVAILABLE_SHOWN = 5;

/**
 * The index of the one case the question names: by id, then by exact title,
 * then by a part of the title, each among the cases whose file contains `file`.
 */
export function caseOf(input: CaseQuestion): number {
  const { test: asked, file } = input;
  if (asked === undefined && file === undefined) throw new Error('name a test, a file, or both');
  const tests = input.execution.tests.map((test, at) => ({ test, at }));
  const inFile = file === undefined ? tests : tests.filter(({ test }) => test.file?.includes(file) === true);
  const found = asked === undefined ? inFile : named(inFile, asked);
  if (found.length === 1) return found[0]!.at;
  if (found.length === 0) throw new Error(unresolved(input.execution, question(input)));
  const shown = found.slice(0, AVAILABLE_SHOWN).map(({ test }) => test.id).join(', ');
  const more = found.length > AVAILABLE_SHOWN ? `, and ${found.length - AVAILABLE_SHOWN} more` : '';
  throw new Error(`${found.length} recorded cases ${question(input)}: ${shown}${more}; name one by its id`);
}

function named<Found extends { readonly test: { readonly id: string; readonly name: string } }>(
  tests: readonly Found[],
  asked: string,
): readonly Found[] {
  const byId = tests.find(({ test }) => test.id === asked);
  if (byId !== undefined) return [byId];
  const exact = tests.filter(({ test }) => test.name === asked);
  if (exact.length === 1) return exact;
  return tests.filter(({ test }) => test.name.toLowerCase().includes(asked.toLowerCase()));
}

/** The question as a reader typed it, for a refusal to repeat. */
function question(input: CaseQuestion): string {
  const test = input.test === undefined ? '' : `matching \`${input.test}\``;
  const file = input.file === undefined ? '' : `in \`${input.file}\``;
  return [test, file].filter((part) => part !== '').join(' ');
}

/**
 * The refusal for a question no recorded case fits, showing the ids it does hold.
 *
 * Naming only the missing id leaves nothing to compare it against, and the
 * usual cause is an id spelled some other way. A handful of recorded ids shows
 * the shape in one glance, and an index of thousands answers in a few lines.
 */
function unresolved(index: ExecutionIndex, asked: string): string {
  const total = index.tests.length;
  if (total === 0) return `The record holds no case ${asked}: it records no cases at all.`;
  const shown = index.tests.slice(0, AVAILABLE_SHOWN).map((candidate) => `  ${candidate.id}`);
  return [
    `The record holds no case ${asked}.`,
    `It records ${total} case id(s), of which:`,
    ...shown,
    ...(total > shown.length ? [`  and ${total - shown.length} more.`] : []),
    'Name a case by its id, `<repository-relative file> > <describe path and name>`, by its title, or by a part of the title one case has.',
  ].join('\n');
}
