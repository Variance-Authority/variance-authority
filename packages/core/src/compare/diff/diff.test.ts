import { describe, expect, it } from 'vitest';
import { normalize } from '../../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../../rules/normalize/fixture.js';
import { diffSnapshots } from './index.js';
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

  it('bands a role change as geometry', () => {
    const before = capture({ root: node({ role: 'button', name: 'Save' }) });
    const after = capture({ root: node({ role: 'link', name: 'Save' }) });

    const result = diff(before, after);
    expect(result.deltas.find((delta) => delta.kind === 'role-changed')?.band).toBe('geometry');
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
