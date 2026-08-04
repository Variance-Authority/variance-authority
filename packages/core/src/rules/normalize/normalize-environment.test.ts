import { describe, expect, it } from 'vitest';
import { normalize } from './index.js';
import { CHROMIUM_PROFILE, capture, node } from './fixture.js';

/**
 * ADR-0003's claims about what a render hash is a hash *of*.
 *
 * Split from `normalize.test.ts` because these cases hold the tree fixed and
 * vary everything around it — the observation profile, the engine, the fonts,
 * the order the same input arrived in. They are the tests that keep a hash from
 * meaning "this markup" when it has to mean "this markup, observed this way",
 * and the only ones that need a second profile to say anything at all.
 *
 * The same discipline as the parent file: a `hash stable` case is a difference
 * that must not invalidate a baseline, and a `hash changes` case is its negative
 * control.
 */

const hashOf = (root: ReturnType<typeof node>, options = {}): string =>
  normalize(capture({ root }), options).renderHash;

describe('observation profiles', () => {
  const tree = node({ tag: 'button', text: 'Save', rect: { x: 0, y: 0, width: 80, height: 32 } });

  it('omits rects under a profile without layout, rather than zeroing them', () => {
    const snapshot = normalize(capture({ root: tree }));
    expect(snapshot.root.rect).toBeUndefined();
  });

  it('records rects under a profile with layout', () => {
    const snapshot = normalize(capture({ root: tree, profile: CHROMIUM_PROFILE }));
    expect(snapshot.root.rect).toEqual({ x: 0, y: 0, width: 80, height: 32 });
  });

  it('never lets two profiles produce the same render hash', () => {
    // The two occupy different manifest slots and must not be comparable, or a
    // JSDOM run could satisfy a Chromium baseline while blind to geometry.
    expect(normalize(capture({ root: tree })).renderHash).not.toBe(
      normalize(capture({ root: tree, profile: CHROMIUM_PROFILE })).renderHash,
    );
  });

  it('lets the engine override the cascade it resolved itself', () => {
    const snapshot = normalize(
      capture({
        root: node({
          rules: [{ selector: '.x', declare: { 'font-size': '1rem' } }],
          computedStyle: { 'font-size': '16px' },
        }),
        profile: CHROMIUM_PROFILE,
      }),
    );
    expect(snapshot.root.style['font-size']).toBe('16px');
  });
});

describe('environment key', () => {
  it('invalidates when a font changes, though no code did', () => {
    const root = node({ tag: 'p', text: 'hello' });
    expect(normalize(capture({ root, fonts: ['Inter/400/normal/aaa'] })).renderHash).not.toBe(
      normalize(capture({ root, fonts: ['Inter/400/normal/bbb'] })).renderHash,
    );
  });

  it('invalidates on an engine bump', () => {
    const root = node({ tag: 'p', text: 'hello' });
    expect(normalize(capture({ root, engine: 'jsdom@26.0.0' })).renderHash).not.toBe(
      normalize(capture({ root, engine: 'jsdom@26.1.0' })).renderHash,
    );
  });

  it('is insensitive to the order fonts were listed in', () => {
    const root = node({ tag: 'p', text: 'hello' });
    expect(normalize(capture({ root, fonts: ['a/400/normal/1', 'b/700/italic/2'] })).renderHash).toBe(
      normalize(capture({ root, fonts: ['b/700/italic/2', 'a/400/normal/1'] })).renderHash,
    );
  });
});

describe('determinism', () => {
  it('produces the same hash for a re-run of identical input', () => {
    const build = () =>
      node({
        rules: [{ selector: '.x', declare: { color: 'red', margin: '4px' } }],
        children: [node({ tag: 'span', text: 'hi' })],
      });

    expect(hashOf(build())).toBe(hashOf(build()));
  });

  it('is insensitive to the order rules were reported in', () => {
    const ordered = node({
      rules: [
        { selector: '.a', declare: { color: 'red' }, specificity: [0, 1, 0], order: 0 },
        { selector: '.b', declare: { 'background-color': 'blue' }, specificity: [0, 1, 0], order: 1 },
      ],
    });
    const reversed = node({
      rules: [
        { selector: '.b', declare: { 'background-color': 'blue' }, specificity: [0, 1, 0], order: 1 },
        { selector: '.a', declare: { color: 'red' }, specificity: [0, 1, 0], order: 0 },
      ],
    });

    expect(hashOf(ordered)).toBe(hashOf(reversed));
  });
});
