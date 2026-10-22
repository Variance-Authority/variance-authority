import type { Declaration } from '@variance-authority/core/format';
import { propertyNames } from './dom-list.js';

/**
 * A style rule's declarations, as the page declared them.
 *
 * Read off the CSSOM rather than the sheet's text, so a value is the one the
 * engine parsed. The exception is a shorthand still waiting on a `var()`, whose
 * longhands the engine leaves empty: it is read under the name the rule's text
 * declares it by.
 */
export function declarationsOf(style: CSSStyleDeclaration): Declaration[] {
  const declarations: Declaration[] = [];
  let pending = false;

  for (const property of propertyNames(style)) {
    const value = style.getPropertyValue(property);

    // An empty value here is not "no declaration". Chromium enumerates a
    // `var()`-tainted shorthand as its *longhand* names with empty values —
    // pending substitution — so `padding: var(--x) var(--y)` appears as four
    // empty `padding-*` entries and skipping them dropped the declaration
    // entirely. JSDOM's CSSOM keeps the authored shorthand instead, so the same
    // stylesheet produced different captures under the two profiles and a
    // shorthand/longhand rewrite read as a change under `chromium` only.
    // Found by P4; invisible to either profile scored alone.
    if (value === '') {
      pending = true;
      continue;
    }

    declarations.push(declaration(property, value, style));
  }

  if (!pending) return declarations;

  // Recover the shorthand the pending longhands came from, by the name the
  // engine serializes it under: Chromium writes a pending shorthand into
  // `cssText` as declared, and answers `getPropertyValue` for that shorthand
  // alone. A list of shorthands we know of lost every one it did not hold —
  // `padding-block: calc(var(--spacing) * 4)` is Tailwind v4's `py-4`, and the
  // site's home page painted over 1,000 px short without its `px-*` and `py-*`.
  //
  // Restricted to `var()`-bearing values because that is the only thing that
  // leaves a longhand pending: a shorthand with a resolvable value enumerates as
  // longhands *with* values, and re-emitting it here would declare the same
  // properties twice. It is emitted unexpanded, as ADR-0003 requires —
  // decomposition is versioned by `core`'s ruleset, not by the engine.
  const emitted = new Set(declarations.map((each) => each.property));
  for (const shorthand of declaredNames(style.cssText)) {
    if (emitted.has(shorthand)) continue;
    const value = style.getPropertyValue(shorthand);
    if (value === '' || !value.includes('var(')) continue;
    emitted.add(shorthand);
    declarations.push(declaration(shorthand, value, style));
  }

  return declarations;
}

/** The property names a declaration block's text declares, in order. */
function declaredNames(text: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;

  const take = (end: number): void => {
    const colon = text.indexOf(':', start);
    if (colon > start && colon < end) names.push(text.slice(start, colon).trim().toLowerCase());
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '\\') index += 1;
    else if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ';' && depth === 0) {
      take(index);
      start = index + 1;
    }
  }
  take(text.length);

  return names;
}

function declaration(property: string, value: string, style: CSSStyleDeclaration): Declaration {
  const references = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!);

  return {
    property,
    value,
    important: style.getPropertyPriority(property) === 'important',
    ...(references.length > 0 ? { references } : {}),
  };
}
