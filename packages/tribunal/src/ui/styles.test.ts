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

const SCHEME =
  /@media \(prefers-color-scheme: (?:dark|light)\) \{([\s\S]*?)\n\}/.exec(REVIEW_STYLES)?.[1] ??
  '';

const MOTION =
  /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(REVIEW_STYLES)?.[1] ?? '';

describe('REVIEW_STYLES', () => {
  it('parses into rules, so nothing below passes by reading an empty list', () => {
    expect(RULES.length).toBeGreaterThan(30);
    expect(SCHEME).not.toBe('');
  });

  it('declares each selector once, so no rule silently reshapes another', () => {
    // A stylesheet is append-only in practice and the last rule wins, so a name
    // reused for a second purpose does not conflict — it quietly redresses
    // whatever already had it. `.va-stage` was the subject column before it was
    // the pane the plate scrolls in, and the column inherited a border, a corner
    // radius and a 70vh ceiling on the way past.
    const counted = new Map<string, number>();
    for (const rule of RULES) counted.set(rule.selector, (counted.get(rule.selector) ?? 0) + 1);

    expect([...counted].filter(([, times]) => times > 1).map(([selector]) => selector)).toEqual([]);
  });

  it('lets no column be widened by what is inside it', () => {
    // A flex child sizes to its content unless it is told not to, and the content
    // here is a 1280-pixel capture the reviewer asked to see at 1:1. Without this
    // the columns grow to fit the plate, the app clips at the viewport, and the
    // panel carrying the findings and the two decision buttons is pushed off the
    // right edge at exactly the magnification somebody zoomed in to judge.
    for (const selector of ['.va-subject', '.va-stage']) {
      expect(RULES.find((rule) => rule.selector === selector)?.body).toContain('min-width: 0');
    }
    expect(RULES.find((rule) => rule.selector === '.va-loupe')?.body).toContain('max-width: 100%');
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
    for (const selector of ['.va-plate img', '.va-side-by-side img']) {
      expect(RULES.find((rule) => rule.selector === selector)?.body).toContain('pixelated');
    }
  });

  it('keeps every layer of a comparison at one magnification', () => {
    // Two rasters at two scales is not a comparison. It is two pictures with a
    // line between them, and it reads as a change everywhere the line falls —
    // which is what an escape from the plate's width on one layer produced.
    const plate = RULES.find((rule) => rule.selector === '.va-plate img')?.body;

    expect(plate).toContain('width: 100%');
    for (const rule of RULES.filter((each) => each.selector.startsWith('.va-plate'))) {
      expect(rule.body).not.toMatch(/max-width:\s*none/);
      // And nothing inside the plate clips: the candidate is frequently the
      // taller of the two, and a crop to the baseline's height would take the
      // change itself off the bottom of the frame.
      expect(rule.body).not.toMatch(/overflow:\s*hidden/);
    }
  });

  it('rides the seam with the picture rather than parking it underneath', () => {
    // Sticky inside the scrolling stage, and pulled back over the plate so it
    // costs no height: the control that moves the boundary stays on the boundary,
    // whatever the reviewer has scrolled to on nine thousand pixels of route.
    const seam = RULES.find((rule) => rule.selector === '.va-seam')?.body;

    expect(seam).toContain('position: sticky');
    expect(seam).toContain('margin-bottom: -22px');
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

  it('leaves a keyboard reviewer able to see where they are', () => {
    // The reset above strips the platform's own ring along with everything else,
    // and this surface reports `nested-interactive` and unreachable controls for
    // a living. The forcing case is the wipe seam: an appearance-stripped range
    // with no border of its own, which without this is a control a keyboard
    // reviewer can hold and cannot find.
    const ring = RULES.find((rule) => rule.selector.includes(':focus-visible'))?.body;

    expect(ring).toMatch(/outline: 2px solid/);
    // An outline and not a border, because a border is layout: it would move the
    // seam by two pixels at the moment it is being used to measure two pixels.
    // And no radius either — the outline already traces the corner the control
    // has, so declaring one here reshapes the control on focus.
    expect(ring).not.toMatch(/border/);
  });

  it('asks for nothing that moves once a reader has said they want less', () => {
    // Motion is never how anything here is said, so there is nothing to preserve.
    // What this block may not do is take away the *state* the motion was carrying
    // — a reader who asked for less movement did not ask to be shown less — so it
    // is held to durations and to nothing else.
    const declarations = [...MOTION.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map(
      (match) => match[1]!,
    );

    expect(declarations.length).toBeGreaterThan(2);
    for (const property of declarations) {
      expect(property).toMatch(/^(animation-|transition-|scroll-behavior$)/);
    }
  });

  it('says which reading is on screen in the bar rather than over the picture', () => {
    // The corner of the plate is not a place at 4×, where the plate is five
    // thousand pixels wide and its corner is off the edge of the pane. The bar
    // does not scroll.
    expect(RULES.some((rule) => rule.selector === '.va-showing')).toBe(true);
    expect(REVIEW_STYLES).not.toContain('va-plate-tag');
  });

  it('re-decides only colour in the second scheme', () => {
    // Declarations only — a trailing `;` is what separates one from the selector
    // it sits under, and the sheet writes one on every line.
    const declarations = [...SCHEME.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map((match) => ({
      property: match[1]!,
      value: match[2]!.trim(),
    }));

    // Layout, weight and the cause/collateral distinction are decided once. A
    // second scheme that could move a box is a second chance to disagree with
    // the region coordinates the run measured — so the alternate scheme is
    // allowed to re-decide the palette the rest of the sheet spends, and nothing
    // else. Which scheme is the alternate is a design decision and moves; that
    // only one of them decides anything but colour does not.
    expect(declarations.length).toBeGreaterThan(5);
    for (const { property, value } of declarations) {
      expect(property).toMatch(/color$|^background$|^--va-/);
      expect(value).toMatch(/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent)$/i);
    }
  });
});
