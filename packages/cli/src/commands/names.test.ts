import { describe, expect, it } from 'vitest';
import type { NamesConfig } from '../config-names.js';
import { nameIndex, readName, structuralParent } from './names.js';

/**
 * A name, read as the coordinate it is.
 *
 * The cases below are the ones a suite actually writes: a baseline spelled out
 * loud, an axis whose values contain the separator, an axis left out of the
 * middle of a name, and two names of the same length whose difference is one
 * word. Each of those is a reading the longest-prefix rule cannot produce, and
 * together they are why a grammar exists.
 */

const GRAMMAR: NamesConfig = {
  axes: [
    { axis: 'state', values: ['default', 'empty', 'new-flow'] },
    { axis: 'colour', values: ['green', 'glass'] },
    { axis: 'flag', values: ['ff-off', 'ff-on'] },
  ],
};

const indexOf = (...ids: readonly string[]) => nameIndex(ids, GRAMMAR);

describe('reading a name', () => {
  it('takes the stem and the axes it carries, in grammar order', () => {
    expect(readName('story:checkout--glass-ff-on', GRAMMAR)).toMatchObject({
      stem: 'story:checkout',
      axes: [
        { axis: 'colour', value: 'glass' },
        { axis: 'flag', value: 'ff-on' },
      ],
    });
  });

  it('reads a value containing the separator as one word', () => {
    // `ff-on` is one value and not `ff` plus `on`, which is the entire reason
    // the axis carries a vocabulary rather than a pattern.
    expect(readName('story:checkout--ff-on', GRAMMAR).axes).toEqual([
      { axis: 'flag', value: 'ff-on' },
    ]);
  });

  it('lets an axis be absent from the middle of a name', () => {
    // Nothing is said about colour here, and the flag is still the flag. Read
    // positionally, `ff-on` would have been asked to be a colour.
    expect(readName('story:checkout--new-flow-ff-on', GRAMMAR).axes).toEqual([
      { axis: 'state', value: 'new-flow' },
      { axis: 'flag', value: 'ff-on' },
    ]);
  });

  it('keeps a base value in the name and drops it from the coordinate', () => {
    // The two halves of the same subject: what the author wrote, and where it
    // sits. `checkout--default` is `checkout`, said out loud.
    const name = readName('story:checkout--default', GRAMMAR);
    expect(name.axes).toEqual([{ axis: 'state', value: 'default' }]);
    expect(name.coordinate).toEqual([]);
    expect(name.stem).toBe('story:checkout');
  });

  it('will not read a name that is only an axis', () => {
    // A subject called `dark` is a subject named after an axis. Read as one, it
    // would have an empty stem and sit beside every other stemless name.
    expect(readName('ff-on', GRAMMAR)).toMatchObject({ stem: 'ff-on', axes: [] });
  });

  it('does not find a value inside a longer word', () => {
    expect(readName('story:checkout-glassware', GRAMMAR).axes).toEqual([]);
  });
});

describe('walking one axis toward its base', () => {
  it('says nothing about a name the grammar found nothing in', () => {
    // Not an error and not a guess. A name outside the format is a name this
    // section was not told about, and answering it would be the unconfigured
    // reading printed as a configured one.
    const index = indexOf('story:checkout--default', 'story:checkout--sideways');
    expect(structuralParent('story:checkout--sideways', index)).toBeUndefined();
  });

  it('measures a variation against the baseline, however that baseline is spelled', () => {
    const index = indexOf('story:checkout--default', 'story:checkout--empty');
    expect(structuralParent('story:checkout--empty', index)).toEqual({
      ok: true,
      parent: 'story:checkout--default',
      step: { axis: 'state', from: 'default', to: 'empty' },
    });
  });

  it('answers what the difference between the green one and the glass one is', () => {
    // Neither name is a prefix of the other, so this is the pair the prefix rule
    // cannot reach at all. The vocabulary says which is the base, and therefore
    // which way the step runs.
    const index = indexOf('story:checkout--green', 'story:checkout--glass');
    expect(structuralParent('story:checkout--glass', index)).toEqual({
      ok: true,
      parent: 'story:checkout--green',
      step: { axis: 'colour', from: 'green', to: 'glass' },
    });
  });

  it('crosses the last axis only, so a link is one axis', () => {
    const index = indexOf(
      'story:checkout--default',
      'story:checkout--glass',
      'story:checkout--glass-ff-on',
    );
    expect(structuralParent('story:checkout--glass-ff-on', index)).toMatchObject({
      parent: 'story:checkout--glass',
      step: { axis: 'flag', from: 'ff-off', to: 'ff-on' },
    });
  });

  it('takes the nearest neighbour the run planned, and the axis itself when there is none', () => {
    const index = indexOf('story:checkout--default', 'story:checkout--glass');
    expect(structuralParent('story:checkout--glass', index)).toMatchObject({
      parent: 'story:checkout--default',
      step: { axis: 'colour', from: 'green', to: 'glass' },
    });
  });

  it('says nothing about a subject sitting at the base', () => {
    const index = indexOf('story:checkout--default', 'story:checkout--empty');
    expect(structuralParent('story:checkout--default', index)).toBeUndefined();
  });

  it('will not link two stems', () => {
    // Same axis, different components. A difference between these two is two
    // components, and no axis names it.
    const index = indexOf('story:checkout--empty', 'story:cart--empty');
    expect(structuralParent('story:cart--empty', index)).toBeUndefined();
  });

  it('refuses a coordinate two subjects share rather than picking one', () => {
    const index = indexOf('story:checkout--default', 'story:checkout', 'story:checkout--empty');
    expect(structuralParent('story:checkout--empty', index)).toMatchObject({
      ok: false,
      because: expect.stringContaining('2 subjects'),
    });
  });
});
