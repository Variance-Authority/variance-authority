import { describe, expect, it } from 'vitest';
import { mostSpecific, specificityOf } from './specificity.js';

/**
 * Specificity from selector text, where a host has no computed style to say
 * which declaration wins.
 */
describe('specificityOf', () => {
  it('counts a pseudo-element CSS 2 wrote with one colon as a type', () => {
    expect(specificityOf('a:before')).toEqual([0, 0, 2]);
    expect(specificityOf('a:first-line')).toEqual([0, 0, 2]);
  });

  it('counts a pseudo-element written with two colons as a type', () => {
    expect(specificityOf('::marker')).toEqual([0, 0, 1]);
    expect(specificityOf('input::placeholder')).toEqual([0, 0, 2]);
  });

  it('counts a pseudo-class as a class', () => {
    expect(specificityOf('a:hover')).toEqual([0, 1, 1]);
  });

  it('reads a parenthesis inside a quoted attribute value as text, not as the close', () => {
    expect(specificityOf(':where([title=")"] #x)')).toEqual([0, 0, 0]);
    expect(specificityOf(':is([title=")"] #x)')).toEqual([1, 1, 0]);
  });

  it('closes an unclosed argument at the end of the selector, as CSS syntax does', () => {
    expect(specificityOf(':not(a')).toEqual([0, 0, 1]);
  });
});

describe('mostSpecific', () => {
  it('answers the most specific branch of a list', () => {
    expect(mostSpecific('a, .b, #c')).toEqual([1, 0, 0]);
  });
});
