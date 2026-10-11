import { codeUnitOrder } from '@variance-authority/core/segment';
import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { readsNames } from './discover.js';

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
 */

/** Files shown when `limit` is not said; every one is counted. */
const SHOWN = 50;

interface Question {
  readonly question: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const counted = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;
const verbOf = (tool: { readonly name: string }): string => tool.name.replace(/^docs_/, '').replace(/_/g, '-');
const flagOf = (property: string): string => `--${property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/** A value as a shell would take it back: quoted only when a word would not survive. */
function wordOf(value: unknown): string {
  const text = Array.isArray(value) ? value.join(',') : String(value);
  return text !== '' && /^[\w./:@^,+=%-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

/** A question spelled as it is asked alone, so it can be pasted back. */
export function spelled(question: Question): string {
  const flags = Object.entries(question.input).map(([property, value]) => `${flagOf(property)} ${wordOf(value)}`);
  return [question.question, ...flags].join(' ');
}

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

function limitArg(input: Readonly<Record<string, unknown>>): number {
  const said = input['limit'];
  return typeof said === 'number' && Number.isInteger(said) && said > 0 ? said : SHOWN;
}

const evidenceOf = (lines: readonly number[]): string =>
  lines.length === 0 ? 'the file' : `${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')}`;

/** Whether a question among those crossed reads every file's names, which a host reads with the tree. */
export function namesWanted(input: Readonly<Record<string, unknown>>): boolean {
  const said = input['questions'];
  return Array.isArray(said) && said.some((one: unknown) => {
    if (typeof one !== 'object' || one === null) return false;
    const { question, input: given } = one as Record<string, unknown>;
    return question === 'discover' && typeof given === 'object' && given !== null && readsNames(given as Record<string, unknown>);
  });
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

    wants: (input) => {
      const said = input['questions'];
      return Array.isArray(said) && said.some((one: unknown) => {
        if (typeof one !== 'object' || one === null) return false;
        const { question, input: given } = one as Record<string, unknown>;
        const operand = operands.find((candidate) => verbOf(candidate) === question);
        return operand?.wants?.((given ?? {}) as Record<string, unknown>) === true;
      });
    },

    run: (subject, input, invocation?: ToolInvocation<Subject>) => {
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

      const sets = asked.map(({ question, which, files }): FileSet => {
        try {
          return files(subject, question.input, invocation);
        } catch (refusal) {
          throw new Error(`${which}: ${refusal instanceof Error ? refusal.message : String(refusal)}`);
        }
      });

      // Smallest first, so each step tests the fewest files.
      const [first, ...rest] = [...sets].sort((left, right) => left.files.size - right.files.size);
      const common = [...first!.files.keys()].filter((file) => rest.every((set) => set.files.has(file))).sort(codeUnitOrder);

      const lines = questions.map((question, at) => {
        const set = sets[at]!;
        const unread = set.unread === undefined || set.unread.length === 0 ? '' : ` — ${set.unread.join('; ')}`;
        return `${at + 1}. \`${spelled(question)}\`: ${counted(set.files.size)}${unread}`;
      });
      if (common.length === 0) return [...lines, '', 'No file is in all of them.'].join('\n');

      const limit = limitArg(input);
      lines.push('', `${counted(common.length)} in all of them.`, '');
      for (const file of common.slice(0, limit)) {
        lines.push(`${file} — ${sets.map((set, at) => `${at + 1}: ${evidenceOf(set.files.get(file)!)}`).join(' · ')}`);
      }
      if (common.length > limit) lines.push('', `${common.length - limit} more not shown; a higher \`limit\` shows them.`);
      return lines.join('\n');
    },
  };
  return tool;
}
