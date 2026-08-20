import { describe, expect, it } from 'vitest';
import { REVIEW_STYLES } from './styles.js';

/**
 * The stylesheet, held to the positions its own comment states.
 *
 * A stylesheet is the one artifact here nobody can assert by looking at, and
 * this one is handed over as text — so an operator who pastes it into a `<style>`
 * tag has no build step, no linter and no type between them and a rule that
 * quietly hides a finding. These are the properties a reviewer's conclusion
 * depends on, not the colours.
 */

interface Rule {
  readonly selector: string;
  readonly body: string;
}

/** Flat rules only; the one nested block is read separately below. */
const RULES: readonly Rule[] = [...REVIEW_STYLES.replace(/@media[\s\S]*?\n\}/g, '').matchAll(
  /^([^@{}\n]+)\{([^}]*)\}/gm,
)].map((match) => ({ selector: match[1]!.trim(), body: match[2]!.trim() }));

const DARK = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/.exec(REVIEW_STYLES)?.[1] ?? '';

describe('REVIEW_STYLES', () => {
  it('parses into rules, so nothing below passes by reading an empty list', () => {
    expect(RULES.length).toBeGreaterThan(30);
    expect(DARK).not.toBe('');
  });

  it('draws a cause and its collateral differently, not in two shades', () => {
    // The distinction ranking by area cannot make. If the two ever collapse to
    // one treatment, the box that was edited and the box that reflowed around it
    // read as the same finding.
    const cause = RULES.find((rule) => rule.selector === '.va-region.va-cause')?.body;
    const collateral = RULES.find((rule) => rule.selector === '.va-region.va-collateral')?.body;

    expect(cause).toBeDefined();
    expect(collateral).toBeDefined();
    // Weight and line style, so the two are still distinguishable printed, at a
    // reader's colour vision, or through a screenshot of a screenshot.
    expect(cause).toContain('2px solid');
    expect(collateral).toContain('1px dashed');
  });

  it('never smooths a capture', () => {
    const renderings = RULES.filter((rule) => rule.body.includes('image-rendering'));

    // A reviewer zoomed into a 2px shift must see 2px rather than an
    // interpolation of it, so there is no such thing as a rule here that opts
    // back into smoothing.
    expect(renderings.length).toBeGreaterThan(1);
    for (const rule of renderings) expect(rule.body).toContain('image-rendering: pixelated');
    for (const selector of ['.va-frame img', '.va-side-by-side img']) {
      expect(RULES.find((rule) => rule.selector === selector)?.body).toContain('pixelated');
    }
  });

  it('hides nothing, so injecting it can never remove a finding', () => {
    // The counterpart of degrading to unstyled: not pasting the sheet costs
    // appearance and no information, and pasting it must cost neither.
    const hiding = RULES.filter(
      (rule) =>
        /display:\s*none/.test(rule.body) ||
        /visibility:\s*hidden/.test(rule.body) ||
        /opacity:\s*0(?!\.)/.test(rule.body) ||
        /(^|;)\s*content:/.test(rule.body),
    );

    expect(hiding.map((rule) => rule.selector)).toEqual([]);
  });

  it('re-decides only colour in the dark scheme', () => {
    const properties = [...DARK.matchAll(/([a-z-]+):/g)].map((match) => match[1]!);

    // Layout, weight and the cause/collateral distinction are decided once. A
    // second scheme that could move a box is a second chance to disagree with
    // the region coordinates the run measured.
    expect(properties.length).toBeGreaterThan(5);
    for (const property of properties) expect(property).toMatch(/color$|^background$/);
  });
});
