import type { FileSet } from '@variance-authority/mcp/tools';
import { listArg } from './discover-operands.js';
import { FoundNothing } from './find.js';

/** Input, as a tool is handed it. */
type Input = Readonly<Record<string, unknown>>;

/**
 * The names `symbol` is asked about, each once, in the order given: a list, or
 * one name said as a string, which is read whole.
 */
export function namesOf(input: Input): readonly string[] {
  const names = listArg(input, 'name');
  if (names.length === 0) throw new Error('`name` is required and must name at least one name');
  return names;
}

/** `one` asked of each name, in order: what it gives, or, for a name nothing declares, that refusal; `missed` keeps those apart. */
function eachOf<Value>(input: Input, one: (input: Input) => Value): readonly ({ value: Value } | { missed: FoundNothing })[] {
  return namesOf(input).map((name) => {
    try {
      return { value: one({ ...input, name }) };
    } catch (refusal) {
      if (refusal instanceof FoundNothing) return { missed: refusal };
      throw refusal;
    }
  });
}

/**
 * Each name's answer by `one`, in the order asked, a blank line apart; a name
 * nothing declares is said in its place by the answer it gets alone. A list
 * nothing in which is declared is refused as one such name is, with each said.
 */
export function eachAnswer(input: Input, one: (input: Input) => string): string {
  const answers = eachOf(input, one);
  if (answers.every((answer) => 'missed' in answer)) throw missedAll(answers);
  return answers.map((answer) => ('value' in answer ? answer.value : answer.missed.message)).join('\n\n');
}

/** What `one` gives for each name something declares; when nothing declares any, the refusal `eachAnswer` gives. */
export function eachDeclared<Value>(input: Input, one: (input: Input) => Value): readonly Value[] {
  const answers = eachOf(input, one);
  if (answers.every((answer) => 'missed' in answer)) throw missedAll(answers);
  return answers.flatMap((answer) => ('value' in answer ? [answer.value] : []));
}

/** One refusal for a list nothing in which is declared: each name's, a blank line apart, and one name's alone. */
function missedAll(answers: readonly ({ value: unknown } | { missed: FoundNothing })[]): FoundNothing {
  const missed = answers.flatMap((answer) => ('missed' in answer ? [answer.missed] : []));
  const [first] = missed;
  if (missed.length === 1 && first !== undefined) return first;
  return new FoundNothing(missed.map((refusal) => refusal.message).join('\n\n'));
}

/** The files of every set, each with the lines any names and the coverage any could not read. */
export function joinedFiles(sets: readonly FileSet[]): FileSet {
  const files = new Map<string, number[]>();
  const unread = [...new Set(sets.flatMap((set) => set.unread ?? []))];
  for (const set of sets) {
    for (const [file, lines] of set.files) {
      const held = files.get(file) ?? [];
      held.push(...lines.filter((line) => !held.includes(line)));
      files.set(file, held);
    }
  }
  return { files, ...(unread.length === 0 ? {} : { unread }) };
}
