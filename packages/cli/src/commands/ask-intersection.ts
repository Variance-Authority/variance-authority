import { wordsOf } from '@variance-authority/help';
import { verbOf } from '@variance-authority/mcp/tools';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { parseArgs } from '../parse.js';
import { flagged } from './ask-flagged.js';
import { QUESTIONS, inputFor, questionFor, refuseWords } from './asking.js';

/**
 * The questions `variance ask intersection` crosses, read off the words after
 * it: each is one argument, typed in quotes the way it would be asked alone,
 * and read by the same parser and catalogue that would have read it alone. A
 * question asked inside an intersection is never spelled differently from one
 * asked outside it.
 *
 * What reads the checkout — `--changed-file`, `--taint-file`, `--just-answer` —
 * is said once, for the intersection, because every question is answered over
 * one reading. A question carrying one is refused rather than read as though
 * it narrowed that question alone.
 */

/** Flags that mean something about the reading or the answer, never about one question. */
const OUTSIDE = ['--changed-file', '--taint-file', '--just-answer', '--format', '--at', '--claims', '--config'];

/** The questions whose answer is a set of files, as they are typed. */
const crossable = (): string =>
  QUESTIONS.filter((question) => question.source?.files !== undefined).map((question) => verbOf(question.tool)).join(', ');

/** One question, parsed as `variance ask` would parse it alone. */
function parsedQuestion(text: string, at: number): { readonly question: string; readonly input: Readonly<Record<string, unknown>> } {
  let words: readonly string[];
  try {
    words = wordsOf(text);
  } catch (error) {
    throw new OperatorError(`question ${at}: ${messageOf(error)}`, { cause: error });
  }
  try {
    const outside = words.find((word) => OUTSIDE.includes(word));
    if (outside !== undefined) {
      throw new OperatorError(`\`${outside}\` is said once, after \`intersection\` and outside the quotes, not inside one question`);
    }
    const parsed = parseArgs(['ask', ...words]);
    if (parsed.command !== 'ask' || parsed.question === undefined) throw new OperatorError('a question names what it asks: `symbol --name selectBalance`');
    const tool = questionFor(parsed.question).source;
    if (tool === undefined) throw new OperatorError(`\`${parsed.question}\` is about a run, not the source`);
    // A question with nothing to cross is refused before its words, so a
    // nested `intersection` reads as what it is rather than as stray quotes.
    if (tool.files === undefined) throw new OperatorError(`\`${parsed.question}\` answers no set of files; the questions that do: ${crossable()}`);
    refuseWords(tool, parsed.reports);
    return { question: parsed.question, input: inputFor(tool, flagged(parsed)) };
  } catch (error) {
    throw new OperatorError(`question ${at}, \`${text}\`: ${messageOf(error)}`, { cause: error });
  }
}

/** The input `intersection` is run with: its questions, in the order typed, and its own `--limit`. */
export function intersectionInput(reports: readonly string[], limit: number | undefined): Readonly<Record<string, unknown>> {
  return {
    questions: reports.map((text, at) => parsedQuestion(text, at + 1)),
    ...(limit === undefined ? {} : { limit }),
  };
}
