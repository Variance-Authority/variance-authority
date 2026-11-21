import type { FileSet } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import { FoundNothing } from './find.js';

/** Input, as a tool is handed it. */
type Input = Readonly<Record<string, unknown>>;

/**
 * The names `symbol` is asked about: one, or several said as a comma list,
 * each once, in the order given. A comma is part of no name, so a name without
 * one is read whole, as it always was. An empty name between commas is a typo,
 * refused rather than read as nothing asked.
 */
export function namesOf(input: Input): readonly string[] {
  const said = stringArg(input, 'name');
  if (!said.includes(',')) return [said];
  const names = said.split(',').map((name) => name.trim());
  if (names.includes('')) throw new Error(`\`${said}\` has an empty name between its commas; say the names as \`a,b\`.`);
  return [...new Set(names)];
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
  if (namesOf(input).length === 1) return one(input);
  const answers = eachOf(input, one);
  const text = answers.map((answer) => ('value' in answer ? answer.value : answer.missed.message)).join('\n\n');
  if (answers.some((answer) => 'value' in answer)) return text;
  throw new FoundNothing(text);
}

/** What `one` gives for each name something declares; when nothing declares any, the first name's refusal. */
export function eachDeclared<Value>(input: Input, one: (input: Input) => Value): readonly Value[] {
  if (namesOf(input).length === 1) return [one(input)];
  const answers = eachOf(input, one);
  const values = answers.flatMap((answer) => ('value' in answer ? [answer.value] : []));
  const [first] = answers;
  if (values.length === 0 && first !== undefined && 'missed' in first) throw first.missed;
  return values;
}

/** The files of every set, each with the lines any of them names, in the order first named. */
export function joinedFiles(sets: readonly FileSet[]): FileSet {
  const files = new Map<string, number[]>();
  for (const set of sets) {
    for (const [file, lines] of set.files) {
      const held = files.get(file) ?? [];
      held.push(...lines.filter((line) => !held.includes(line)));
      files.set(file, held);
    }
  }
  return { files };
}
