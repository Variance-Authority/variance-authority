/**
 * Selector specificity, computed from selector text.
 *
 * Needed because the CSSOM does not expose it. Under a profile without computed
 * style this decides which declaration wins, so an error here silently changes
 * a snapshot's values rather than crashing — which is why the parser below
 * declines rather than guesses on anything it does not recognize.
 */

export type Specificity = readonly [number, number, number];

/** Selectors whose specificity comes from their argument, not from themselves. */
const ARGUMENT_SPECIFICITY = new Set(['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any']);

export function specificityOf(selector: string): Specificity {
  let ids = 0;
  let classes = 0;
  let types = 0;

  let index = 0;
  const input = selector.trim();

  while (index < input.length) {
    const char = input[index]!;

    if (char === '#') {
      ids += 1;
      index += 1 + consumeIdentifier(input, index + 1);
      continue;
    }

    if (char === '.') {
      classes += 1;
      index += 1 + consumeIdentifier(input, index + 1);
      continue;
    }

    if (char === '[') {
      classes += 1;
      index = skipTo(input, index, ']') + 1;
      continue;
    }

    if (char === ':') {
      const doubled = input[index + 1] === ':';
      const nameStart = index + (doubled ? 2 : 1);
      const nameLength = consumeIdentifier(input, nameStart);
      const name = input.slice(nameStart, nameStart + nameLength).toLowerCase();
      let cursor = nameStart + nameLength;

      if (input[cursor] === '(') {
        const close = matchingParen(input, cursor);
        const argument = input.slice(cursor + 1, close);
        cursor = close + 1;

        if (ARGUMENT_SPECIFICITY.has(name)) {
          // `:is()`/`:not()`/`:has()` take the specificity of their most
          // specific argument. `:where()` deliberately takes zero, which is the
          // whole reason it exists, so it is not in this set.
          const [argIds, argClasses, argTypes] = mostSpecific(argument);
          ids += argIds;
          classes += argClasses;
          types += argTypes;
        } else if (name !== 'where') {
          classes += 1;
        }
      } else if (doubled || PSEUDO_ELEMENTS.has(name)) {
        // Pseudo-elements count as type selectors; pseudo-classes as classes.
        types += 1;
      } else {
        classes += 1;
      }

      index = cursor;
      continue;
    }

    if (/[a-z*|_-]/i.test(char)) {
      const length = consumeIdentifier(input, index) || 1;
      if (char !== '*') types += 1;
      index += length;
      continue;
    }

    index += 1;
  }

  return [ids, classes, types];
}

/** The most specific branch of a comma-separated selector list. */
export function mostSpecific(selectorList: string): Specificity {
  let best: Specificity = [0, 0, 0];
  for (const branch of splitSelectorList(selectorList)) {
    const candidate = specificityOf(branch);
    if (compareSpecificity(candidate, best) > 0) best = candidate;
  }
  return best;
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Split on commas that are not inside brackets, parentheses, or strings.
 *
 * `:is(a, b)` and `[title="x, y"]` both contain commas that do not separate
 * selectors. Splitting naively would produce branches that match nothing, which
 * would silently drop real rules from the capture.
 */
export function splitSelectorList(selectorList: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < selectorList.length; i += 1) {
    const char = selectorList[i]!;

    if (quote !== null) {
      current += char;
      if (char === quote && selectorList[i - 1] !== '\\') quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;

    if (char === ',' && depth === 0) {
      if (current.trim().length > 0) branches.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) branches.push(current.trim());
  return branches;
}

const PSEUDO_ELEMENTS = new Set([
  'before', 'after', 'first-line', 'first-letter', 'selection', 'backdrop',
  'placeholder', 'marker', 'file-selector-button',
]);

/**
 * Length of the CSS identifier at `start`.
 *
 * Identifiers are `[A-Za-z0-9_-]`, any non-ASCII code point, and backslash
 * escapes — the last of which matter here because CSS-in-JS and Tailwind emit
 * class names like `.md\\:w-1\\/2`, where an unescaped read would stop at the
 * colon and mis-parse the remainder of the selector as a pseudo-class.
 */
function consumeIdentifier(input: string, start: number): number {
  let length = 0;

  while (start + length < input.length) {
    const char = input[start + length]!;

    if (char === '\\') {
      length += 2;
      continue;
    }

    if (/[A-Za-z0-9_-]/.test(char) || char.charCodeAt(0) > 0x7f) {
      length += 1;
      continue;
    }

    break;
  }

  return length;
}

function skipTo(input: string, start: number, terminator: string): number {
  for (let i = start + 1; i < input.length; i += 1) {
    if (input[i] === terminator) return i;
  }
  return input.length - 1;
}

function matchingParen(input: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < input.length; i += 1) {
    if (input[i] === '(') depth += 1;
    else if (input[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return input.length - 1;
}
