import { describe, expect, it } from 'vitest';
import { count, element, headline, segments, sentence, when } from './text.js';

describe('the words the surface says', () => {
  it('never prints a count of one as a template', () => {
    expect(count(1, 'pixel')).toBe('1 pixel');
    expect(count(2, 'pixel')).toBe('2 pixels');
    expect(count(8818, 'pixel')).toBe('8,818 pixels');
  });

  it('gives a rule a headline a person reads before the id a machine does', () => {
    expect(headline('nested-interactive')).toBe('A control inside another control');
  });

  it('humanises a rule it has not heard of rather than dropping the finding', () => {
    // A newer report is not a reason to draw a blank line where a defect is.
    expect(headline('some-future-rule')).toBe('Some future rule');
  });

  it('takes the element out of the phrase that leads to it', () => {
    // `where` is spoken outside-in, and the last hop is the thing on screen —
    // the noun the report's sentence was written to follow and never prints.
    expect(element('navigation → link "SNKR.shop"')).toBe('link "SNKR.shop"');
    expect(element(undefined)).toBeUndefined();
  });

  it('gives a clause back its capital and its stop', () => {
    expect(sentence('a button is nested inside another control')).toBe(
      'A button is nested inside another control.',
    );
    expect(sentence('reads "Menu 0" and is named "cart".')).toBe(
      'Reads "Menu 0" and is named "cart".',
    );
  });
});

describe('a timestamp is a thing a person reads', () => {
  it('prints the zone it kept rather than converting to the reader’s', () => {
    // Two builds in one list are read against each other. Converted to whoever
    // opened the page, the same instant is two different strings depending on
    // which laptop is looking, and the ordering stops being checkable by eye.
    expect(when('2026-08-29T07:34:47.404Z')).toBe('29 Aug 2026, 07:34 UTC');
  });

  it('gives back anything it cannot read as a date', () => {
    // The field is whatever the writer put there. `Invalid Date` would be this
    // surface losing the only copy of it.
    expect(when('whenever')).toBe('whenever');
  });
});


describe('segments', () => {
  it('sets a backticked identifier apart from the prose around it', () => {
    expect(segments('renders identically to `story:card`, so it reaches nothing')).toEqual([
      { text: 'renders identically to ', code: false },
      { text: 'story:card', code: true },
      { text: ', so it reaches nothing', code: false },
    ]);
  });

  it('leaves an unbalanced mark alone rather than guessing where it closes', () => {
    expect(segments('a stray ` mark')).toEqual([{ text: 'a stray ` mark', code: false }]);
  });
});
