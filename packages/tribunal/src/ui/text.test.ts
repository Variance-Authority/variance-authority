import { describe, expect, it } from 'vitest';
import { briefly, count, element, headline, magnitude, segments, sentence, when } from './text.js';

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

describe('the size of a change is counted in what is being decided', () => {
  it('leads with the number of distinct changes, not the pixel total', () => {
    // `3,885 pixels differ` is the number the category leads with and the least
    // useful one available: it answers how much of the raster is a different
    // colour, which nobody is deciding anything about.
    const line = magnitude({
      verdict: 'changed',
      changedPixels: 3885,
      regions: [
        { pixels: 2140, fingerprint: 'f1' },
        { pixels: 900, fingerprint: 'f1' },
        { pixels: 425, fingerprint: 'f2' },
        { pixels: 420, fingerprint: 'f2' },
      ],
    });

    expect(line).toContain('2 changes over 4 regions');
    expect(line).toContain('2,140, 900, 425 pixels and 1 smaller');
    expect(line).toContain('3,885 in all');
  });

  it('drops the changes clause when nothing carried a shape', () => {
    // A shape is what says two regions are the same thing happening twice.
    // Counting regions as changes without one would be inventing the join.
    const line = magnitude({ verdict: 'changed', changedPixels: 300, regions: [{ pixels: 200 }, { pixels: 100 }] });

    expect(line).toBe('2 regions: 200, 100 pixels');
    expect(line).not.toContain('change');
  });

  it('says how many regions the run recorded no shape for', () => {
    const line = magnitude({
      verdict: 'changed',
      changedPixels: 300,
      regions: [{ pixels: 200, fingerprint: 'f1' }, { pixels: 100 }],
    });

    expect(line).toContain('1 change over 2 regions');
    expect(line).toContain('1 region the run recorded no shape for');
  });

  it('names the total as a total only when the listed regions are not all of it', () => {
    expect(magnitude({ verdict: 'changed', changedPixels: 300, regions: [{ pixels: 300, fingerprint: 'f1' }] })).toBe(
      '1 change over 1 region: 300 pixels',
    );
  });

  it('reports a total nothing localised as exactly that', () => {
    // The absence is the finding and it belongs to whoever wrote the run. A
    // page that dressed the number up would be hiding the one thing wrong here.
    expect(magnitude({ verdict: 'changed', changedPixels: 3885, regions: [] })).toBe(
      '3,885 pixels differ, in regions this run did not record',
    );
  });

  it('says nothing was compared when there was no baseline to compare against', () => {
    // A new render has no baseline. *0 pixels differ* reports a comparison that
    // never happened, and *in regions this run did not record* blames the run
    // for not localising a difference there was nothing to find.
    const line = magnitude({ verdict: 'new', changedPixels: 0, regions: [] });

    expect(line).toBe('No baseline, so nothing was compared');
  });

  it('says no pixel differs when the pixel axis measured that, rather than blaming the run for regions', () => {
    // An absorbed render opened from the settled fold differs by nothing once
    // the ignores are out, and has no region to record.
    expect(
      magnitude({ verdict: 'changed', changedPixels: 0, regions: [], signals: { pixels: 'unchanged' } }),
    ).toBe('No pixel differs');
  });

  it('says an absorbed render differs only where the ignores took it out', () => {
    // `ignored` is a render whose pixels differed and every differing pixel was
    // absorbed. The pixel axis is read after the subtraction, so it says
    // `unchanged`, and *no pixel differs* would deny the difference the ignore
    // was written for.
    expect(
      magnitude({ verdict: 'ignored', changedPixels: 0, regions: [], signals: { pixels: 'unchanged' } }),
    ).toBe('No pixel differs outside the ignored regions');
  });

  it('reads a zero count by what the pixel axis says, never as a measurement it was not', () => {
    // A subject that gained or lost its pixels, or changed size, arrives with no
    // count at all; one that occupies none was never compared; and a record
    // without the signal has not said either way. Absent is not empty.
    const zero = { verdict: 'changed', changedPixels: 0, regions: [] } as const;

    expect(magnitude({ ...zero, signals: { pixels: 'changed' } })).toBe(
      'Its pixels changed, and the run kept no count of them',
    );
    expect(magnitude({ ...zero, signals: { pixels: 'unobservable' } })).toBe(
      'It occupies no pixels, so none were compared',
    );
    expect(magnitude(zero)).toBe('The run did not say whether it measured pixels');
  });

  it('keeps the same three counts in the short form', () => {
    expect(
      briefly({
        verdict: 'changed',
        changedPixels: 3040,
        regions: [
          { pixels: 2140, fingerprint: 'f1' },
          { pixels: 900, fingerprint: 'f1' },
        ],
      }),
    ).toBe('1 change · 2 regions · 3,040px');
  });

  it('reads a zero by the pixel axis in the short form too', () => {
    // The rail prints this beside a render's name, and so does reach's alarm. A
    // *0 pixels* there is the same unmeasured zero the long form stopped saying.
    const zero = { verdict: 'changed', changedPixels: 0, regions: [] } as const;

    expect(briefly({ ...zero, verdict: 'new' })).toBe('no baseline');
    expect(briefly({ ...zero, signals: { pixels: 'unchanged' } })).toBe('0 pixels');
    expect(briefly({ ...zero, signals: { pixels: 'changed' } })).toBe('pixels changed, uncounted');
    expect(briefly({ ...zero, signals: { pixels: 'unobservable' } })).toBe('occupies no pixels');
    expect(briefly(zero)).toBe('no pixel signal');
  });

  it('reads a zero the same way in both forms, words aside', () => {
    // The short form sits beside a render's name with the long form as its
    // tooltip, so the two read one state. No surface hands the short form an
    // absorbed render today; when one does, it says what the tooltip says.
    const absorbed = {
      verdict: 'ignored',
      changedPixels: 0,
      regions: [],
      signals: { pixels: 'unchanged' },
    } as const;

    expect(magnitude(absorbed)).toBe('No pixel differs outside the ignored regions');
    expect(briefly(absorbed)).toBe('0 pixels outside ignores');
  });
});
