import { describe, expect, it } from 'vitest';
import { canonicalizeTokens, matchingParen } from './value.js';

/**
 * The one parenthesis matcher every reader of a CSS value or selector shares:
 * `url()` and `var()` here, `:is()` and its kin in the DOM specificity parser,
 * `counter()` in a generated box's `content`.
 */
describe('matchingParen', () => {
  it('skips a nested pair to the parenthesis that closes the one it opened on', () => {
    expect(matchingParen('f(a(b)c)d', 1)).toBe(7);
  });

  it('reads a parenthesis inside a double- or single-quoted string as text', () => {
    expect(matchingParen('f(")")x', 1)).toBe(5);
    expect(matchingParen("f(')')x", 1)).toBe(5);
  });

  it('reads a backslash-escaped quote inside a string as text', () => {
    expect(matchingParen('f("a\\")")x', 1)).toBe(8);
  });

  it('answers the length of the input when nothing closes it', () => {
    expect(matchingParen('f(a(b)', 1)).toBe(6);
  });
});

describe('canonicalizeTokens', () => {
  it('keeps a quoted url() payload whole when it holds a parenthesis', () => {
    expect(canonicalizeTokens('url("a)b.png") no-repeat')).toBe('url("a)b.png") no-repeat');
  });

  it('keeps an unclosed url() as written', () => {
    expect(canonicalizeTokens('url(foo')).toBe('url(foo');
  });
});
