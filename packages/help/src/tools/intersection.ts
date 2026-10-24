import { codeUnitOrder } from '@variance-authority/core/segment';
import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { readsNames } from './discover.js';
import { FoundNothing } from './find.js';
import { limitOf, notShown, spellingOf, verbOf } from '@variance-authority/mcp/tools';

/**
 * `docs_intersection` — the files every one of several whole questions answers.
 *
 * Each operand is a question that could be asked alone — `symbol --name
 * selectBalance`, `discover --from src/Wallet.ts` — and each is asked through
 * its `files`, uncapped: a question asked alone prints the first fifty, and the
 * file two questions agree on can sit past the cap of either. Only the answer
 * is limited.
 *
 * `discover` crosses the sets one question names; this crosses questions. A
 * question whose answer is not a set of files — a package listing, a stack —
 * has nothing to cross, and is refused with the questions that do.
 *
 * Each common file says what put it there, operand by operand: the lines a
 * question answered with, or the file whole when the question answers files
 * without a line. What a question could not read is said beside that question,
 * so an answer short of files does not read as complete.
 *
 * A question about a name nothing declares answers no file, and says so beside
 * itself: no file is then in all of them, and that answer is thrown as a
 * {@link FoundNothing}, as its question's own is, so a surface reading a reused
 * generation asks it again before the empty set is believed.
 */

/** Files shown when `limit` is not said; every one is counted. */
const SHOWN = 50;

/** One question's files, and the sentence it answered with when it found no name. */
type Crossed = FileSet & { readonly unfound?: string };

interface Question {
  readonly question: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const counted = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;

function questionsOf(input: Readonly<Record<string, unknown>>): readonly Question[] {
  const said = input['questions'];
  const list = Array.isArray(said) ? said : [];
  if (list.length < 2) throw new Error(`\`intersection\` crosses two or more questions; it was given ${list.length}.`);
  return list.map((one) => {
    const question = typeof one === 'object' && one !== null ? (one as Record<string, unknown>)['question'] : undefined;
    const given = typeof one === 'object' && one !== null ? (one as Record<string, unknown>)['input'] : undefined;
    if (typeof question !== 'string' || (given !== undefined && (typeof given !== 'object' || given === null || Array.isArray(given)))) {
      throw new Error('each question is an object with `question` and `input`: `{"question": "symbol", "input": {"name": "selectBalance"}}`');
    }
    return { question, input: (given ?? {}) as Readonly<Record<string, unknown>> };
  });
}

const evidenceOf = (lines: readonly number[]): string =>
  lines.length === 0 ? 'the file' : `${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')}`;

/**
 * The questions as said, before `run` validates them: what a host reads ahead
 * of asking, where a malformed question is left for `run` to refuse.
 */
function saidQuestions(input: Readonly<Record<string, unknown>>): readonly Question[] {
  const said = input['questions'];
  if (!Array.isArray(said)) return [];
  return said.flatMap((one: unknown) => {
    if (typeof one !== 'object' || one === null) return [];
    const { question, input: given } = one as Record<string, unknown>;
    if (typeof question !== 'string') return [];
    return [{ question, input: typeof given === 'object' && given !== null ? (given as Record<string, unknown>) : {} }];
  });
}

/** Whether a question among those crossed reads every file's names, which a host reads with the tree. */
export function namesWanted(input: Readonly<Record<string, unknown>>): boolean {
  return saidQuestions(input).some(({ question, input: given }) => question === 'discover' && readsNames(given));
}

/**
 * The intersection over `operands`, the questions it may cross. Generic over the
 * subject because it reads nothing: each operand is handed the subject and the
 * invocation the host gave it, unchanged.
 */
export function intersectionOf<Subject>(operands: readonly Tool<Subject>[]): Tool<Subject> {
  const crossable = (): string => operands.filter((tool) => tool.files !== undefined).map(verbOf).join(', ');

  const tool: Tool<Subject> = {
    name: 'docs_intersection',
    description:
      'Answer the files every one of two or more questions answers. Each question is one this server ' +
      'answers alone whose answer is a set of files — `symbol`, `uses`, `search`, `grep`, `discover` — with ' +
      'its own input, and each is read whole, never capped, so a file past the first page of either still ' +
      'meets. Each common file says which lines put it in each question, or that the question answered the ' +
      'whole file.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question, as its tool is named without `docs_`: `symbol`, `discover`.' },
              input: { type: 'object', description: "That question's input, as it takes it alone." },
            },
            required: ['question'],
            additionalProperties: false,
          },
          description: 'Two or more questions, each a set of files.',
        },
        limit: { type: 'integer', description: `Files to show. ${SHOWN} when not said; the rest are counted.` },
      },
      required: ['questions'],
      additionalProperties: false,
    },

    wants: (input) =>
      saidQuestions(input).some(({ question, input: given }) =>
        operands.find((candidate) => verbOf(candidate) === question)?.wants?.(given) === true),

    run: (subject, input, invocation?: ToolInvocation<Subject>) => {
      const spell = spellingOf(invocation);
      const limit = limitOf(input, SHOWN, spell);
      const spelled = ({ question, input: given }: Question): string => spell.operand(question, given);
      const questions = questionsOf(input);
      // Every question is resolved before any is asked, so a misspelled third
      // question costs nothing to refuse.
      const asked = questions.map((question, at) => {
        const operand = [...operands, tool].find((candidate) => verbOf(candidate) === question.question);
        const which = `question ${at + 1}, \`${spelled(question)}\``;
        if (operand === undefined) {
          throw new Error(`${which}: \`${question.question}\` is not a question; the questions that answer a set of files: ${crossable()}`);
        }
        if (operand.files === undefined) {
          throw new Error(`${which}: \`${question.question}\` answers no set of files; the questions that do: ${crossable()}`);
        }
        return { question, which, files: operand.files.bind(operand) };
      });

      // Every question is asked, so each one that found nothing is named.
      const sets = asked.map(({ question, which, files }): Crossed => {
        try {
          return files(subject, question.input, invocation);
        } catch (refusal) {
          if (refusal instanceof FoundNothing) return { files: new Map(), unfound: refusal.message };
          throw new Error(`${which}: ${refusal instanceof Error ? refusal.message : String(refusal)}`);
        }
      });

      // Smallest first, so each step tests the fewest files.
      const [first, ...rest] = [...sets].sort((left, right) => left.files.size - right.files.size);
      const common = [...first!.files.keys()].filter((file) => rest.every((set) => set.files.has(file))).sort(codeUnitOrder);

      const lines = questions.map((question, at) => {
        const set = sets[at]!;
        const said = [...(set.unfound === undefined ? [] : [set.unfound]), ...(set.unread ?? [])];
        return `${at + 1}. \`${spelled(question)}\`: ${counted(set.files.size)}${said.length === 0 ? '' : ` — ${said.join('; ')}`}`;
      });
      if (common.length === 0) {
        const none = [...lines, '', 'No file is in all of them.'].join('\n');
        if (sets.some((set) => set.unfound !== undefined)) throw new FoundNothing(none);
        return none;
      }

      lines.push('', `${counted(common.length)} in all of them.`, '');
      for (const file of common.slice(0, limit)) {
        lines.push(`${file} — ${sets.map((set, at) => `${at + 1}: ${evidenceOf(set.files.get(file)!)}`).join(' · ')}`);
      }
      if (common.length > limit) lines.push('', notShown(common.length - limit, spell));
      return lines.join('\n');
    },
  };
  return tool;
}
