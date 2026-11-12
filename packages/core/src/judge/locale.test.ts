import { describe, expect, it } from 'vitest';
import { normalize } from '../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../rules/normalize/fixture.js';
import { compareLocales } from './locale.js';
import type { RawCapture } from '../format/capture.js';

const LABELS = { base: 'en', other: 'de' };
const compare = (base: RawCapture, other: RawCapture) =>
  compareLocales(normalize(base), normalize(other), LABELS);

/** A button and a caption inside a fixed-width panel, with real boxes. */
function panel(
  label: string,
  caption: string,
  widths: { readonly panel: number; readonly button: number },
): RawCapture {
  return capture({
    profile: CHROMIUM_PROFILE,
    root: node({
      tag: 'div',
      rect: { x: 0, y: 0, width: widths.panel, height: 40 },
      children: [
        node({
          tag: 'button',
          role: 'button',
          name: label,
          text: label,
          rect: { x: 0, y: 0, width: widths.button, height: 32 },
          owners: [{ name: 'Button' }],
        }),
        node({ tag: 'p', text: caption, rect: { x: 0, y: 32, width: 80, height: 8 } }),
      ],
    }),
  });
}

describe('one subject, two locales', () => {
  it('refuses to compare two different subjects', () => {
    const a = normalize(capture({ root: node({ tag: 'p' }), subjectId: 'story:a' }));
    const b = normalize(capture({ root: node({ tag: 'p' }), subjectId: 'story:b' }));

    expect(() => compareLocales(a, b, LABELS)).toThrow(/different subjects/);
  });

  it('counts what was translated', () => {
    const result = compare(
      panel('Continue', 'Renews monthly', { panel: 200, button: 96 }),
      panel('Fortfahren', 'Wird monatlich verlängert', { panel: 200, button: 148 }),
    );

    expect(result.translated).toBe(2);
    expect(result.identical).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

describe('untranslated', () => {
  it('reports a string that did not move while others did', () => {
    const result = compare(
      panel('Continue', 'Renews monthly', { panel: 200, button: 96 }),
      panel('Continue', 'Wird monatlich verlängert', { panel: 200, button: 96 }),
    );

    const found = result.findings.filter((finding) => finding.rule === 'untranslated');

    expect(found).toHaveLength(1);
    expect(found[0]?.band).toBe('content');
    expect(found[0]?.what).toContain('"Continue"');
    expect(found[0]?.what).toContain('or it is a name that does not change');
  });

  it('names the component, so the finding reaches a file', () => {
    const result = compare(
      panel('Continue', 'Renews monthly', { panel: 200, button: 96 }),
      panel('Continue', 'Wird monatlich verlängert', { panel: 200, button: 96 }),
    );

    expect(result.findings[0]?.component).toBe('Button');
  });

  /**
   * Two renders in one language have every string identical, and a tool that
   * called all of them untranslated would be telling the truth about nothing.
   * Some evidence that translation happened at all is the precondition.
   */
  it('says nothing when the whole subject is identical', () => {
    const same = () => panel('Continue', 'Renews monthly', { panel: 200, button: 96 });
    const result = compare(same(), same());

    expect(result.translated).toBe(0);
    expect(result.findings).toEqual([]);
  });

  /**
   * `€ 2,400.00`, `—`, `12` — a currency amount is not a missing translation,
   * and a rule that reported every number would be switched off before it found
   * anything.
   */
  it('ignores strings with no letters in them', () => {
    const amounts = (label: string) =>
      capture({
        root: node({
          tag: 'div',
          children: [
            node({ tag: 'span', text: label }),
            node({ tag: 'span', text: '€ 2,400.00' }),
          ],
        }),
      });

    const result = compare(amounts('Total'), amounts('Gesamt'));

    expect(result.translated).toBe(1);
    expect(result.findings).toEqual([]);
  });
});

describe('overflows-container', () => {
  it('reports a box that fitted in one locale and does not in the other', () => {
    const result = compare(
      panel('Continue', 'Renews monthly', { panel: 200, button: 96 }),
      panel('Fortfahren', 'Wird monatlich verlängert', { panel: 200, button: 260 }),
    );

    const found = result.findings.filter((finding) => finding.rule === 'overflows-container');

    expect(found).toHaveLength(1);
    expect(found[0]?.band).toBe('geometry');
    expect(found[0]?.component).toBe('Button');
    expect(found[0]?.what).toContain('60px wider than what contains it in de');
  });

  /**
   * A layout that was already broken is a real problem and is not this one. A
   * locale comparison that reported it would put a pre-existing bug in front of
   * whoever is reviewing a translation, every time, in every locale.
   */
  it('does not report a box that already overflowed in the base locale', () => {
    const result = compare(
      panel('Continue', 'Renews monthly', { panel: 100, button: 260 }),
      panel('Fortfahren', 'Wird monatlich verlängert', { panel: 100, button: 280 }),
    );

    expect(result.findings.filter((finding) => finding.rule === 'overflows-container')).toEqual([]);
  });

  /**
   * The same rule `unobserved` follows. Under a profile with no layout engine
   * there are no rects, so "no overflow findings" is not an answer about
   * overflow, and the flag is what stops it being read as one.
   */
  it('says it could not decide overflow when neither side carried layout', () => {
    const text = (label: string) => capture({ root: node({ tag: 'p', text: label }) });
    const result = compare(text('Continue'), text('Fortfahren'));

    expect(result.layoutObserved).toBe(false);
    expect(result.findings.filter((finding) => finding.rule === 'overflows-container')).toEqual([]);
  });
});

describe('expansion, measured and not judged', () => {
  /**
   * No threshold, deliberately. "German is 35% longer" is a rule of thumb, and a
   * build that fails on a ratio is a build whose ratio gets raised until it stops
   * failing. The growth is a number a reviewer reads; only overflow — a fact
   * about two rectangles — is a finding.
   */
  it('reports the largest growth and whose it is', () => {
    const result = compare(
      panel('Continue', 'Renews monthly', { panel: 200, button: 96 }),
      panel('Fortfahren', 'Wird monatlich verlängert', { panel: 200, button: 148 }),
    );

    expect(result.expansion?.ratio).toBeCloseTo(148 / 96, 5);
    expect(result.expansion?.component).toBe('Button');
    expect(result.findings).toEqual([]);
  });
});

/**
 * The nodes that were not compared, which is spec 0008's one normative MUST that
 * had no code behind it.
 *
 * Pairing by position stops where the trees diverge — the right call, argued on
 * `pairByPosition` — and the cost is that a divergent subject produces *fewer*
 * findings than a matching one. Unstated, that is this project's central failure
 * arriving inside its own answer: the locale nobody translated reads as the
 * clean one, because none of its strings were looked at.
 *
 * Every case below asserts the count and the findings together. Either alone is
 * satisfiable by a wrong implementation: a count with no findings check passes
 * for a comparison that stopped early and said so; findings with no count passes
 * for exactly the silent narrowing this exists to catch.
 */
describe('what was not compared', () => {
  const two = (first: RawCapture['root'], second: RawCapture['root']) =>
    capture({ root: node({ tag: 'div', children: [first, second] }) });

  it('counts nothing when the trees match, rather than leaving the field absent', () => {
    const result = compare(
      panel('Continue', 'Renews monthly', { panel: 200, button: 96 }),
      panel('Fortfahren', 'Wird monatlich verlängert', { panel: 200, button: 148 }),
    );

    // `{ base: 0, other: 0 }` is an answer — the trees were walked and matched.
    // An absent field would say nobody counted, and a reader cannot tell those
    // apart from a report.
    expect(result.uncompared).toEqual({ base: 0, other: 0, divergedAt: [] });
  });

  it('counts a subtree a tag change took out of the comparison, and names where', () => {
    // The date that renders as `<time>` in one locale and `<span>` in the other.
    // Its string is left behind, and without the count the subject looks cleaner
    // for it.
    const result = compare(
      two(node({ tag: 'span', text: 'Ends 3 May' }), node({ tag: 'p', text: 'Renews monthly' })),
      two(node({ tag: 'time', text: '3. Mai' }), node({ tag: 'p', text: 'Wird verlängert' })),
    );

    expect(result.uncompared.base).toBe(1);
    expect(result.uncompared.other).toBe(1);
    expect(result.uncompared.divergedAt).toEqual(['0/0']);

    // And the strings under it are genuinely gone: one translation counted, not
    // two. That is the number the count exists to qualify.
    expect(result.translated).toBe(1);
  });

  it('counts the children past the shorter list, on whichever side they are', () => {
    // A German plural with an extra element. The extra node is in `other`, so
    // the two sides differ — which is what says which render carried it.
    const result = compare(
      two(node({ tag: 'p', text: 'One item' }), node({ tag: 'p', text: 'Total' })),
      capture({
        root: node({
          tag: 'div',
          children: [
            node({ tag: 'p', text: 'Ein Artikel' }),
            node({ tag: 'p', text: 'Gesamt' }),
            node({ tag: 'p', text: 'und ein weiterer' }),
          ],
        }),
      }),
    );

    expect(result.uncompared).toEqual({ base: 0, other: 1, divergedAt: ['0'] });
  });

  it('reports the whole of both trees when the roots themselves disagree', () => {
    const result = compare(
      capture({ root: node({ tag: 'div', children: [node({ tag: 'p', text: 'Total' })] }) }),
      capture({ root: node({ tag: 'section', children: [node({ tag: 'p', text: 'Gesamt' })] }) }),
    );

    // Nothing was compared, so nothing was found — and this is the shape a
    // reader must never see reported as agreement.
    expect(result.uncompared).toEqual({ base: 2, other: 2, divergedAt: ['0'] });
    expect(result.translated).toBe(0);
    expect(result.findings).toEqual([]);
  });
});
