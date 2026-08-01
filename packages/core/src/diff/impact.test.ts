import { describe, expect, it } from 'vitest';
import { canReflow, impactOf } from '../impact.js';
import { normalize } from '../normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../normalize/fixture.js';
import { diffSnapshots } from './index.js';

/**
 * The three questions this axis exists to answer:
 *
 * 1. Which component changed?
 * 2. What is collateral of a design-system change?
 * 3. Is this a layout update or a styling one?
 *
 * The third is the one the frequency bands could not answer. A spacing token and
 * a colour token are both `token` band — a value moved, structure held — but only
 * one of them can push a box on the other side of the page. Impact is that
 * distinction, and its payoff is a *bound*: a paint-only change has no geometric
 * collateral, which a profile with no layout engine can conclude without
 * measuring anything.
 */

describe('property impact', () => {
  it('classifies box metrics as layout', () => {
    for (const property of ['padding-top', 'width', 'display', 'flex-grow', 'row-gap']) {
      expect(impactOf(property), property).toBe('layout');
    }
  });

  it('classifies typography metrics as layout, not paint', () => {
    // The easy one to get wrong. These change glyph advances, so they resize the
    // boxes containing them and reflow everything after — a "typography token"
    // change is a layout change.
    for (const property of ['font-size', 'line-height', 'letter-spacing', 'text-transform']) {
      expect(impactOf(property), property).toBe('layout');
    }
  });

  it('classifies pure repaints as paint', () => {
    for (const property of ['color', 'background-color', 'box-shadow', 'border-top-color']) {
      expect(impactOf(property), property).toBe('paint');
    }
  });

  it('separates border width from border colour', () => {
    // Width occupies space; colour does not. Treating `border` as one thing would
    // make every colour tweak look capable of moving the page.
    expect(impactOf('border-top-width')).toBe('layout');
    expect(impactOf('border-top-color')).toBe('paint');
  });

  it('knows outline never affects layout', () => {
    // Which is the entire reason `outline` exists as a separate property.
    expect(impactOf('outline-width')).toBe('paint');
  });

  it('knows visibility keeps its box but display does not', () => {
    expect(impactOf('visibility')).toBe('paint');
    expect(impactOf('display')).toBe('layout');
  });

  it('classifies compositor properties as composite', () => {
    for (const property of ['transform', 'opacity', 'filter', 'z-index']) {
      expect(impactOf(property), property).toBe('composite');
    }
  });

  it('treats an unrecognized property as layout', () => {
    // Impact is used to *rule out* collateral, so an unknown treated as paint
    // would let a real reflow pass unexamined.
    expect(impactOf('some-future-property')).toBe('layout');
    expect(canReflow('some-future-property')).toBe(true);
  });
});

describe('layout change versus styling change', () => {
  const styled = (declare: Record<string, string>) =>
    capture({
      root: node({
        rules: [{ selector: '.x', declare }],
        owners: [{ name: 'Button', props: {} }],
      }),
    });

  it('reports a colour change as paint — it can move nothing', () => {
    const diff = diffSnapshots(normalize(styled({ color: 'red' })), normalize(styled({ color: 'blue' })));

    expect(diff.impact).toBe('paint');
    expect(diff.roots[0]!.impact).toBe('paint');
  });

  it('reports a spacing change as layout, under a profile with no layout engine', () => {
    // The claim that matters: this tier cannot measure, and still knows the
    // change is capable of moving things.
    const diff = diffSnapshots(
      normalize(styled({ 'padding-top': '4px' })),
      normalize(styled({ 'padding-top': '12px' })),
    );

    expect(diff.impact).toBe('layout');
  });

  it('keeps band and impact independent', () => {
    // Both are `token` band: a value moved, structure held. They differ only in
    // whether anything can move as a result, which is the distinction the bands
    // do not carry.
    const paint = diffSnapshots(normalize(styled({ color: 'red' })), normalize(styled({ color: 'blue' })));
    const layout = diffSnapshots(
      normalize(styled({ 'padding-top': '4px' })),
      normalize(styled({ 'padding-top': '12px' })),
    );

    expect(paint.roots[0]!.band).toBe('token');
    expect(layout.roots[0]!.band).toBe('token');
    expect(paint.impact).not.toBe(layout.impact);
  });

  it('reports mixed when a change set both reflows and repaints', () => {
    const diff = diffSnapshots(
      normalize(styled({ color: 'red', 'padding-top': '4px' })),
      normalize(styled({ color: 'blue', 'padding-top': '12px' })),
    );

    expect(diff.impact).toBe('mixed');
  });
});

describe('folding a rect change under its cause', () => {
  const withRect = (padding: string, y: number) =>
    capture({
      root: node({
        rules: [{ selector: '.x', declare: { 'padding-top': padding } }],
        rect: { x: 0, y, width: 100, height: 40 },
        owners: [{ name: 'Button', props: {} }],
      }),
      profile: CHROMIUM_PROFILE,
    });

  it('marks the rect delta as derived from the style change that caused it', () => {
    // One edit observed twice. Reporting it as a `token` root plus an unrelated
    // `geometry` one makes a reviewer work out that they are the same thing.
    const diff = diffSnapshots(normalize(withRect('4px', 0)), normalize(withRect('12px', 8)));
    const rect = diff.deltas.find((delta) => delta.kind === 'rect-changed')!;

    expect(rect.derivedFrom).toBeDefined();
    expect(diff.roots).toHaveLength(1);
  });

  it('leaves a rect change independent when nothing here reflowed', () => {
    // The node moved because something *upstream* reflowed and pushed it. That is
    // propagation, and it is the interesting case — it must not be folded away.
    const pushed = (y: number) =>
      capture({
        root: node({
          rules: [{ selector: '.x', declare: { color: 'red' } }],
          rect: { x: 0, y, width: 100, height: 40 },
          owners: [{ name: 'Button', props: {} }],
        }),
        profile: CHROMIUM_PROFILE,
      });

    const diff = diffSnapshots(normalize(pushed(0)), normalize(pushed(8)));
    const rect = diff.deltas.find((delta) => delta.kind === 'rect-changed')!;

    expect(rect.derivedFrom).toBeUndefined();
  });
});

describe('naming the component that changed', () => {
  const tree = (color: string, buttonProps: Record<string, unknown> = {}) =>
    capture({
      root: node({
        owners: [{ name: 'CheckoutPage', props: {} }],
        children: [
          node({
            tag: 'button',
            owners: [
              { name: 'Button', props: buttonProps },
              { name: 'Header', props: {} },
              { name: 'CheckoutPage', props: {} },
            ],
            rules: [{ selector: '.btn', declare: { color } }],
          }),
        ],
      }),
    });

  it('names the component the change originated in as a root', () => {
    const diff = diffSnapshots(normalize(tree('red')), normalize(tree('blue')));
    const button = diff.components.find((component) => component.name === 'Button')!;

    expect(button.role).toBe('root');
    expect(button.deltaCount).toBeGreaterThan(0);
  });

  it('names enclosing components as collateral, not as changes of their own', () => {
    // "Three components changed" reads like three problems. "Button changed, and
    // two components render it" reads like one, which is what it is.
    const diff = diffSnapshots(normalize(tree('red')), normalize(tree('blue')));
    const header = diff.components.find((component) => component.name === 'Header')!;

    expect(header.role).toBe('collateral');
    expect(header.deltaCount).toBe(0);
  });

  it('records where a changed component shows up', () => {
    const diff = diffSnapshots(normalize(tree('red')), normalize(tree('blue')));
    const button = diff.components.find((component) => component.name === 'Button')!;

    expect(button.renderedIn).toContain('Header');
  });

  it('does not credit an enclosing component with its descendants` deltas', () => {
    // Otherwise the page component is the biggest change in every diff, every time.
    const diff = diffSnapshots(normalize(tree('red')), normalize(tree('blue')));
    const page = diff.components.find((component) => component.name === 'CheckoutPage')!;

    expect(page.deltaCount).toBe(0);
  });
});
