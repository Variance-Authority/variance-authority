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

  it('gives the element reset no specificity to spend', () => {
    // A reset that reaches for a tag scores (0,1,1) once it is scoped to the
    // app root, which beats every single-class rule in the sheet. The rail item
    // and the mode pill each declared no border and were drawn with one, and
    // nothing about the source says so: the sheet reads correctly and the render
    // simply is not it. :where() is the difference between a default and a rule.
    const reset = RULES.filter((rule) => /\.va-app\s+[a-z*]/.test(rule.selector));

    expect(reset.length).toBeGreaterThan(5);
    for (const rule of reset) expect(rule.selector.trim().startsWith(':where(')).toBe(true);
  });

  it('bounds the shell so the document never grows with the build', () => {
    // Twenty full-page routes stacked down one document measured at 26,945px of
    // page. A reviewer who has to scroll past a whole render to reach the next
    // subject stops reading them, which is the review blindness this project
    // exists to refuse — arriving as a layout rather than as a ranking.
    const shell = RULES.find((rule) => rule.selector === '.va-app')?.body;
    const scroll = RULES.find((rule) => rule.selector === '.va-scroll')?.body;

    expect(shell).toMatch(/height: 100dvh/);
    expect(shell).toMatch(/overflow: hidden/);
    // Which only bounds anything if something inside it scrolls instead.
    expect(scroll).toMatch(/overflow: auto/);
    // And a flex child floors at its content unless told otherwise, which would
    // push the shell past the viewport rather than scrolling inside it.
    expect(scroll).toMatch(/min-height: 0/);
    expect(RULES.find((rule) => rule.selector === '.va-body')?.body).toMatch(/min-height: 0/);
  });

  it('re-decides only colour in the dark scheme', () => {
    // Declarations only — a trailing `;` is what separates one from the selector
    // it sits under, and the sheet writes one on every line.
    const declarations = [...DARK.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map((match) => ({
      property: match[1]!,
      value: match[2]!.trim(),
    }));

    // Layout, weight and the cause/collateral distinction are decided once. A
    // second scheme that could move a box is a second chance to disagree with
    // the region coordinates the run measured — so the dark scheme is allowed to
    // re-decide the palette the rest of the sheet spends, and nothing else.
    expect(declarations.length).toBeGreaterThan(5);
    for (const { property, value } of declarations) {
      expect(property).toMatch(/color$|^background$|^--va-/);
      expect(value).toMatch(/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent)$/i);
    }
  });
});
