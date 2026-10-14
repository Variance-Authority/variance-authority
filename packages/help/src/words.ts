/**
 * One argument, split into words the way a POSIX shell splits a command line.
 *
 * `intersection` takes whole questions, and a question is typed as one quoted
 * argument so it can be pasted from where it was asked alone. Splitting it is
 * the shell's grammar, not ours: whitespace separates words, single quotes keep
 * everything as written, double quotes take a backslash before `"` or `\`, and
 * a backslash outside quotes makes the next character literal. No expansion —
 * there is nothing here to expand against.
 */
export function wordsOf(text: string): readonly string[] {
  const words: string[] = [];
  let word: string | undefined;
  let quote: "'" | '"' | undefined;

  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
    } else if (quote === '"') {
      const next = text[at + 1];
      if (char === '"') quote = undefined;
      else if (char === '\\' && (next === '"' || next === '\\')) {
        word += next;
        at += 1;
      } else word += char;
    } else if (/\s/.test(char)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
      word ??= '';
    } else if (char === '\\' && at + 1 < text.length) {
      word = (word ?? '') + text[at + 1];
      at += 1;
    } else {
      word = (word ?? '') + char;
    }
  }

  if (quote !== undefined) throw new Error(`\`${text}\` opens a ${quote} quote and never closes it`);
  if (word !== undefined) words.push(word);
  return words;
}
