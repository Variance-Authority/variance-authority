import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { RunReport, VariationRecord } from '@variance-authority/report';
import { variations } from './variations.js';

/**
 * The answer, because the answer is the product.
 *
 * What an agent needs from this tool is a sentence about what a flag *does* —
 * not a list of subject names it could already read out of the summary. So these
 * assert the sentence, and the one absence that is not an empty list.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const reportOf = (records?: readonly VariationRecord[]): RunReport => ({
  runVersion: 1,
  at: '2026-08-12T10:00:00.000Z',
  identity: IDENTITY,
  retention: 'durable',
  observations: [],
  ...(records !== undefined ? { variations: records } : {}),
});

const MEASURED: VariationRecord = {
  subject: 'story:checkout--new-flow',
  parent: 'story:checkout--default',
  identical: false,
  bands: ['content', 'structure'],
  components: ['Checkout', 'Button'],
  digest: 'v1:9f2a11c4e77b',
  because:
    '`story:checkout--new-flow` differs from `story:checkout--default` in content and ' +
    'structure, led by `Checkout`.',
};

describe('what a declared variation turned out to be', () => {
  it('names the parent, the bands and the components behind the difference', () => {
    const answer = variations.run(reportOf([MEASURED]), {});

    expect(answer).toContain('story:checkout--new-flow ← story:checkout--default');
    expect(answer).toContain('content, structure');
    expect(answer).toContain('components: Checkout, Button');
  });

  it('keeps a band with no answer apart from one with a narrower answer', () => {
    // An agent reading this is deciding whether the pair settles a question.
    // Folding the two into one list would make "we did not look" and "we looked
    // at less than the band is" the same line.
    const answer = variations.run(
      reportOf([{ ...MEASURED, unobserved: ['geometry', 'texture'], narrowed: ['token'] }]),
      {},
    );

    expect(answer).toContain('unobserved here: geometry, texture');
    expect(answer).toContain('narrowed here: token');
  });

  it('counts the ones nothing could be measured for separately', () => {
    const answer = variations.run(
      reportOf([
        MEASURED,
        { subject: 'story:b', because: '`story:b` was not compared: nothing named it' },
      ]),
      {},
    );

    expect(answer.split('\n')[0]).toContain('2 variation(s) — 1 measured');
    expect(answer.split('\n')[0]).toContain('1 not compared');
  });

  it('keeps the inferred pairs apart from the stated ones', () => {
    const answer = variations.run(
      reportOf([
        { ...MEASURED, how: 'declared' },
        { ...MEASURED, subject: 'story:checkout--dark', how: 'named' },
      ]),
      {},
    );

    expect(answer).toContain('1 declared with a tag, 1 read off the names');
    expect(answer.indexOf('declared\n')).toBeLessThan(answer.indexOf('named —'));
  });

  it('narrows to one subject', () => {
    const answer = variations.run(reportOf([MEASURED]), {
      subject: 'story:checkout--new-flow',
    });

    expect(answer).not.toContain('declared variation(s)');
    expect(answer).toContain('story:checkout--default');
  });

  it('answers a subject that declared nothing with the ones that did', () => {
    const answer = variations.run(reportOf([MEASURED]), { subject: 'story:other' });

    expect(answer).toContain('declared no parent');
    expect(answer).toContain('story:checkout--new-flow');
  });

  it('reports the absence as a missing declaration, never as a suite with no variants', () => {
    // A run with no variations is the ordinary run. Answering it with an empty
    // list would claim the suite has no arms, which is a different statement and
    // a false one.
    const answer = variations.run(reportOf(), {});

    expect(answer).toContain('variance-parent:');
    expect(answer).not.toContain('0 declared');
  });
});
