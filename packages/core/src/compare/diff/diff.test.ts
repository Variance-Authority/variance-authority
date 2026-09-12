import { describe, expect, it } from 'vitest';
import { normalize } from '../../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../../rules/normalize/fixture.js';
import { diffSnapshots } from './index.js';
import { loudestBand } from '../band.js';
import type { RawCapture } from '../../format/capture.js';

const snap = (raw: RawCapture) => normalize(raw);

const diff = (before: RawCapture, after: RawCapture) => diffSnapshots(snap(before), snap(after));

describe('refusing incomparable snapshots', () => {
  const tree = () => capture({ root: node({ tag: 'p', text: 'hi' }) });

  it('rejects a cross-profile comparison outright', () => {
    // Not a large diff — a category error. Returning deltas here would let a
    // JSDOM run appear to satisfy a Chromium baseline while blind to geometry.
    const jsdom = snap(tree());
    const chromium = snap(capture({ root: node({ tag: 'p', text: 'hi' }), profile: CHROMIUM_PROFILE }));

    expect(() => diffSnapshots(jsdom, chromium)).toThrow(/observation profiles/);
  });

  it('rejects comparing two different subjects', () => {
    const a = snap(capture({ root: node({ tag: 'p' }), subjectId: 'story:a' }));
    const b = snap(capture({ root: node({ tag: 'p' }), subjectId: 'story:b' }));

    expect(() => diffSnapshots(a, b)).toThrow(/different subjects/);
  });
});

describe('unchanged subjects', () => {
  it('short-circuits on a render-hash hit', () => {
    const build = () => capture({ root: node({ tag: 'p', text: 'hi' }) });
    const result = diff(build(), build());

    expect(result.identical).toBe(true);
    expect(result.deltas).toHaveLength(0);
    expect(result.roots).toHaveLength(0);
  });
});

describe('reporting what the profile cannot see', () => {
  it('names geometry as unobserved under jsdom', () => {
    const build = () => capture({ root: node({ tag: 'p', text: 'hi' }) });
    expect(diff(build(), build()).unobserved).toContain('geometry');
  });

  it('reports nothing unobserved under chromium except texture', () => {
    const build = () => capture({ root: node({ tag: 'p', text: 'hi' }), profile: CHROMIUM_PROFILE });
    expect(diff(build(), build()).unobserved).not.toContain('geometry');
  });

  /**
   * The half `unobserved` cannot carry. A band jsdom cannot decide is reported as
   * undecided and is therefore safe; `token` is the other case — jsdom settles it
   * from what an author declared, so it decides, and returns its answer in the
   * same word a resolved cascade returns. `narrowed` is the only place the two
   * readings are distinguishable.
   */
  it('separates a band answered narrowly from one not answered at all', () => {
    const before = capture({ root: node({ tag: 'p', text: 'hi' }) });
    const after = capture({ root: node({ tag: 'p', text: 'hello' }) });

    const result = diff(before, after);

    expect(result.narrowed).toEqual(['token']);
    expect(result.observability.token).toBe('declared-only');
    // And the contrast: geometry is seen structurally, which does not decide it.
    expect(result.narrowed).not.toContain('geometry');
    expect(result.unobserved).toContain('geometry');
  });

  it('narrows nothing under chromium', () => {
    const build = () => capture({ root: node({ tag: 'p', text: 'hi' }), profile: CHROMIUM_PROFILE });
    const result = diff(build(), build());

    expect(result.narrowed).toEqual([]);
    expect(result.observability.token).toBe('full');
  });
});

describe('node matching', () => {
  const item = (name: string) =>
    node({ tag: 'li', role: 'listitem', name, text: name });

  it('does not report an insertion as a change to every following sibling', () => {
    // The classic positional-diff failure: one insert renumbers all paths after
    // it, and a path-only differ calls all of them changed.
    const before = capture({
      root: node({ tag: 'ul', children: [item('a'), item('b'), item('c')] }),
    });
    const after = capture({
      root: node({ tag: 'ul', children: [item('a'), item('new'), item('b'), item('c')] }),
    });

    const result = diff(before, after);
    const added = result.deltas.filter((delta) => delta.kind === 'node-added');

    expect(added).toHaveLength(1);
    expect(result.deltas.filter((delta) => delta.kind === 'text-changed')).toHaveLength(0);
  });

  it('reports a reorder as movement, not as content changes', () => {
    const before = capture({ root: node({ tag: 'ul', children: [item('a'), item('b')] }) });
    const after = capture({ root: node({ tag: 'ul', children: [item('b'), item('a')] }) });

    const result = diff(before, after);

    expect(result.deltas.filter((delta) => delta.kind === 'node-moved').length).toBeGreaterThan(0);
    expect(result.deltas.filter((delta) => delta.kind === 'text-changed')).toHaveLength(0);
  });

  /**
   * The three shapes a list can take, on nodes with no alias, no accessible name
   * and no provenance — the bucket where every identity key collapses to
   * `tag:li` and only content or position can tell the items apart. Reported
   * together because the fix for one is the failure mode of the others: content
   * pairing alone turns a relabel into a replacement, position pairing alone
   * turns a rotation into five changed strings.
   */
  describe('a list of bare items, where identity keys collapse', () => {
    const items = (...texts: string[]) =>
      capture({
        root: node({ tag: 'ul', children: texts.map((text) => node({ tag: 'li', text })) }),
      });

    it('reports a rotation as movement, not as every string changing', () => {
      const result = diff(items('a', 'b', 'c', 'd', 'e'), items('c', 'd', 'e', 'a', 'b'));

      expect(result.deltas.filter((delta) => delta.kind === 'text-changed')).toHaveLength(0);
      // Two, not five: the smallest set of movements that produces the order.
      expect(result.deltas.filter((delta) => delta.kind === 'node-moved')).toHaveLength(2);
    });

    it('reports a prepend as one addition, with nothing displaced', () => {
      const result = diff(items('a', 'b', 'c'), items('new', 'a', 'b', 'c'));

      expect(result.deltas.filter((delta) => delta.kind === 'node-added')).toHaveLength(1);
      // The three survivors kept their relative order. Reporting them as moved
      // is the same fatigue positional diffing produces, one step removed.
      expect(result.deltas.filter((delta) => delta.kind === 'node-moved')).toHaveLength(0);
      expect(result.deltas.filter((delta) => delta.kind === 'text-changed')).toHaveLength(0);
    });

    it('reports a relabel as one changed string, not a replacement', () => {
      const result = diff(items('a', 'b', 'c'), items('a', 'x', 'c'));

      expect(result.deltas.filter((delta) => delta.kind === 'text-changed')).toHaveLength(1);
      expect(result.deltas.filter((delta) => delta.kind === 'node-added')).toHaveLength(0);
      expect(result.deltas.filter((delta) => delta.kind === 'node-removed')).toHaveLength(0);
    });
  });

  it('reports a removal once, not once per descendant', () => {
    const before = capture({
      root: node({
        tag: 'ul',
        children: [item('a'), node({ tag: 'li', role: 'listitem', name: 'gone', children: [node({ tag: 'span', text: 'x' })] })],
      }),
    });
    const after = capture({ root: node({ tag: 'ul', children: [item('a')] }) });

    const result = diff(before, after);
    expect(result.deltas.filter((delta) => delta.kind === 'node-removed')).toHaveLength(1);
  });
});

describe('banding', () => {
  it('bands a style value change as token', () => {
    const build = (color: string) =>
      capture({ root: node({ rules: [{ selector: '.x', declare: { color } }] }) });

    const result = diff(build('red'), build('blue'));
    expect(result.deltas.every((delta) => delta.band === 'token')).toBe(true);
  });

  it('bands a role change as a11y, not as geometry', () => {
    const before = capture({ root: node({ role: 'button', name: 'Save' }) });
    const after = capture({ root: node({ role: 'link', name: 'Save' }) });

    const result = diff(before, after);
    expect(result.deltas.find((delta) => delta.kind === 'role-changed')?.band).toBe('a11y');
  });

  it('bands a lost accessible name as a11y', () => {
    const before = capture({ root: node({ role: 'button', name: 'Save' }) });
    const after = capture({ root: node({ role: 'button' }) });

    const result = diff(before, after);
    expect(result.deltas.find((delta) => delta.kind === 'name-changed')?.band).toBe('a11y');
  });

  /**
   * The hole that adding this band exposed. `ATTRIBUTE_ALLOWLIST` drops every
   * `aria-*` attribute on the grounds that they resolve into `role`/`name`/
   * `state` — true of `aria-label`, and never true of `aria-describedby`, which
   * resolves into a *description* that nothing captured. A field whose error
   * message was deleted kept its role, its name, its styles and its rect, and
   * compared equal on every tier this project has, raster included.
   */
  it('bands a lost accessible description as a11y', () => {
    const before = capture({
      root: node({ tag: 'input', role: 'textbox', name: 'Email', description: 'We never share it' }),
    });
    const after = capture({ root: node({ tag: 'input', role: 'textbox', name: 'Email' }) });

    const result = diff(before, after);
    const delta = result.deltas.find((d) => d.kind === 'description-changed');

    expect(delta?.band).toBe('a11y');
    expect(delta?.from).toBe('We never share it');
    expect(delta?.to).toBe(undefined);
  });

  it('bands a text change as content, below the geometry it may reflow', () => {
    const before = capture({ root: node({ tag: 'p', text: 'one' }) });
    const after = capture({ root: node({ tag: 'p', text: 'two' }) });

    const result = diff(before, after);
    expect(result.deltas.find((delta) => delta.kind === 'text-changed')?.band).toBe('content');
  });

  /**
   * The property that makes `loudestBand` worth having as one function. A subject
   * where a string changed *and* a control lost its name is an accessibility
   * finding: the entry is one review action, so it is labelled by the loudest
   * thing in it rather than by whichever delta the differ emitted first.
   */
  it('ranks a11y above geometry above token above content', () => {
    expect(loudestBand(['content', 'token'])).toBe('token');
    expect(loudestBand(['content', 'geometry', 'token'])).toBe('geometry');
    expect(loudestBand(['content', 'geometry', 'a11y', 'texture'])).toBe('a11y');
    expect(loudestBand([])).toBe(null);
  });

  /**
   * Both are DOM facts, so the cheap tier settles them outright. This is the
   * measured form of the argument in `docs/comparison.md` §3.3: the category no
   * raster comparison can reach is also the category that costs least to reach.
   */
  it('settles a11y and content under jsdom, with no engine and no image', () => {
    const before = capture({ root: node({ role: 'button', name: 'Save', text: 'Save' }) });
    const after = capture({ root: node({ role: 'button', text: 'Save' }) });

    const result = diff(before, after);

    expect(result.unobserved).not.toContain('a11y');
    expect(result.unobserved).not.toContain('content');
    // And the contrast: metric geometry is exactly what it cannot settle.
    expect(result.unobserved).toContain('geometry');
  });

  it('bands a rect move as geometry, but only where layout exists', () => {
    const build = (x: number) =>
      capture({
        root: node({ tag: 'p', rect: { x, y: 0, width: 10, height: 10 } }),
        profile: CHROMIUM_PROFILE,
      });

    const result = diff(build(0), build(4));
    expect(result.deltas.find((delta) => delta.kind === 'rect-changed')?.band).toBe('geometry');
  });
});

describe('which token a fallback chain blames', () => {
  /**
   * `var(--ks-card-radius, var(--va-radius-md))` — a component token with a
   * system fallback, which is how every real design system is built.
   *
   * `styleTokens` names the outer token, because that is what the author wrote.
   * When it is undefined the value comes from the fallback, so comparing the
   * outer name's recorded value compares `undefined` with `undefined` and
   * concludes the token held. The root then fell through to the component: an
   * edit to the radius *scale* reported as "Card changed internally", once per
   * consuming component, instead of one token root with counted collateral.
   */
  const chained = (scale: string) =>
    capture({
      root: node({
        rules: [
          { selector: ':scope', declare: { '--va-radius-md': scale } },
          { selector: '.x', declare: { 'border-radius': 'var(--ks-card-radius, var(--va-radius-md))' } },
        ],
        owners: [{ name: 'Card' }],
      }),
    });

  it('blames the token that supplied the value, not the one that was named', () => {
    const result = diff(chained('6px'), chained('14px'));

    expect(result.roots.map((root) => `${root.kind}:${root.label}`)).toEqual([
      'token:--va-radius-md',
    ]);
  });

  /**
   * The other half, which the fallback must not break: when the *named* token
   * gains a value where it had none, that override is the root. Both are one
   * root and they are different roots.
   */
  it('blames the override when the named token is the one that appeared', () => {
    const overridden = (declare: Record<string, string>) =>
      capture({
        root: node({
          rules: [
            { selector: ':scope', declare: { '--va-radius-md': '6px', ...declare } },
            { selector: '.x', declare: { 'border-radius': 'var(--ks-card-radius, var(--va-radius-md))' } },
          ],
          owners: [{ name: 'Card' }],
        }),
      });

    const result = diff(overridden({}), overridden({ '--ks-card-radius': '14px' }));

    expect(result.roots.map((root) => `${root.kind}:${root.label}`)).toEqual([
      'token:--ks-card-radius',
    ]);
  });

  /**
   * Refuses to answer rather than guessing. "The named token held and two others
   * moved" is genuinely ambiguous, and a confident wrong token name in front of
   * a reviewer is worse than a coarser true one.
   */
  it('falls through to the component when several tokens moved', () => {
    const many = (radius: string, space: string) =>
      capture({
        root: node({
          rules: [
            { selector: ':scope', declare: { '--va-radius-md': radius, '--va-space-2': space } },
            {
              selector: '.x',
              declare: {
                'border-radius': 'var(--ks-card-radius, var(--va-radius-md))',
                'padding-top': 'var(--va-space-2)',
              },
            },
          ],
          owners: [{ name: 'Card' }],
        }),
      });

    const result = diff(many('6px', '8px'), many('14px', '12px'));
    const kinds = new Set(result.roots.map((root) => root.kind));

    expect(kinds.has('token')).toBe(true);
    expect(result.roots.some((root) => root.kind === 'component')).toBe(true);
  });
});

describe('root attribution', () => {
  /**
   * A theme token consumed by two components — the shape the whole docket
   * argument rests on: one edit, many affected subjects, one review item.
   */
  const themed = (primary: string, buttonProps: Record<string, unknown> = { tone: 'primary' }) =>
    capture({
      root: node({
        rules: [{ selector: ':root', declare: { '--color-primary': primary } }],
        children: [
          node({
            tag: 'button',
            owners: [{ name: 'Button', props: buttonProps }, { name: 'Hero', props: {} }],
            rules: [{ selector: '.btn', declare: { color: 'var(--color-primary)' } }],
          }),
          node({
            tag: 'a',
            owners: [{ name: 'Link', props: {} }, { name: 'Hero', props: {} }],
            rules: [{ selector: '.link', declare: { color: 'var(--color-primary)' } }],
          }),
        ],
      }),
    });

  it('collapses a token change to one root with counted collateral', () => {
    const result = diff(themed('#0000ff'), themed('#ff0000'));

    expect(result.roots).toHaveLength(1);
    const [root] = result.roots;
    expect(root!.kind).toBe('token');
    expect(root!.label).toBe('--color-primary');
    expect(root!.band).toBe('token');
    expect(root!.deltas).toHaveLength(2);
  });

  it('attributes an internal change to the component that owns it', () => {
    // Props held on every boundary, so the change originated inside Button.
    const before = themed('#0000ff');
    const after = capture({
      root: node({
        rules: [{ selector: ':root', declare: { '--color-primary': '#0000ff' } }],
        children: [
          node({
            tag: 'button',
            owners: [{ name: 'Button', props: { tone: 'primary' } }, { name: 'Hero', props: {} }],
            rules: [{ selector: '.btn', declare: { color: 'var(--color-primary)', 'padding-top': '12px' } }],
          }),
          node({
            tag: 'a',
            owners: [{ name: 'Link', props: {} }, { name: 'Hero', props: {} }],
            rules: [{ selector: '.link', declare: { color: 'var(--color-primary)' } }],
          }),
        ],
      }),
    });

    const result = diff(before, after);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.kind).toBe('component');
    expect(result.roots[0]!.label).toBe('Button');
  });

  it('ignores a props change that reaches nothing rendered', () => {
    // Props digests inform attribution but are not render inputs. A prop that
    // changes without altering output must not invalidate a baseline, or every
    // internal refactor becomes a review.
    const result = diff(themed('#0000ff', { tone: 'primary' }), themed('#0000ff', { tone: 'danger' }));
    expect(result.identical).toBe(true);
  });

  it('surfaces an unattributed change rather than absorbing it', () => {
    // No owner chain: provenance failed. That is a defect in this tool, and it
    // must be visible rather than folded into a neighbouring root.
    const before = capture({ root: node({ rules: [{ selector: '.x', declare: { 'padding-top': '4px' } }] }) });
    const after = capture({ root: node({ rules: [{ selector: '.x', declare: { 'padding-top': '8px' } }] }) });

    const result = diff(before, after);
    expect(result.roots[0]!.kind).toBe('unattributed');
  });

  it('collapses an environment change to a single named root', () => {
    // Mass invalidation (spec §7.3): one root, one action, not N subjects.
    const before = capture({ root: node({ tag: 'p', text: 'hi' }), engine: 'chromium@131' });
    const after = capture({ root: node({ tag: 'p', text: 'hi' }), engine: 'chromium@132' });

    const result = diff(before, after);
    const environmentRoots = result.roots.filter((root) => root.kind === 'environment');

    expect(environmentRoots).toHaveLength(1);
    expect(environmentRoots[0]!.label).toContain('chromium@132');
  });
});

describe('prop-boundary attribution', () => {
  const tree = (heroProps: Record<string, unknown>, buttonProps: Record<string, unknown>, color: string) =>
    capture({
      root: node({
        children: [
          node({
            tag: 'button',
            owners: [
              { name: 'Button', props: buttonProps },
              { name: 'Header', props: heroProps },
              { name: 'CheckoutPage', props: {} },
            ],
            rules: [{ selector: '.btn', declare: { color } }],
          }),
        ],
      }),
    });

  it('blames the outermost boundary that moved, not the innermost', () => {
    // Header passes a new prop down to Button. Reporting `Button` would name the
    // messenger; the useful root is the boundary furthest up that actually moved.
    const before = tree({ variant: 'a' }, { variant: 'a' }, 'red');
    const after = tree({ variant: 'b' }, { variant: 'b' }, 'blue');

    const result = diff(before, after);
    const root = result.roots[0]!;

    expect(root.kind).toBe('prop');
    expect(root.label).toBe('CheckoutPage → Header');
  });

  it('falls back to the component when only its own props moved', () => {
    const before = tree({ variant: 'a' }, { variant: 'a' }, 'red');
    const after = tree({ variant: 'a' }, { variant: 'b' }, 'blue');

    const result = diff(before, after);
    expect(result.roots[0]!.label).toBe('Header → Button');
  });
});
