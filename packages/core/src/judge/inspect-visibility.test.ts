import { describe, expect, it } from 'vitest';
import { normalize } from '../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../rules/normalize/fixture.js';
import { inspect, type FindingRule } from './inspect.js';
import type { RawCapture } from '../format/capture.js';

/**
 * What the accessibility rules do about nodes a browser did not lay out.
 *
 * Split from `inspect.test.ts`, and not arbitrarily: every case here is a false
 * positive that a real page produced. A landmark inside a `display: none`
 * subtree, a control under a hidden wrapper, a name a browser assembled with a
 * separator the DOM does not contain — each one fired on markup that is correct
 * at every width anybody looks at it. They are the reason the rules read the
 * rendered tree rather than the document, and they belong together.
 */

const found = (raw: RawCapture): readonly FindingRule[] =>
  inspect(normalize(raw)).map((finding) => finding.rule);

describe('what a browser never built', () => {
  /**
   * The false positive that made the rule unusable on a real site, and the
   * reason the gate is at the walk rather than inside `duplicate-landmark`.
   *
   * A responsive layout renders its mobile navigation into the desktop document
   * and hides it with a class. The DOM holds two `<nav>`; Chrome's tree holds
   * one, because no box was generated for the first. Counting the hidden one
   * reports a duplicate landmark nobody can reach, against markup that is
   * correct at every width it is looked at.
   */
  it('does not count a landmark inside a display:none subtree', () => {
    const page = (display: string) =>
      capture({
        profile: CHROMIUM_PROFILE,
        root: node({
          tag: 'body',
          children: [
            node({
              tag: 'details',
              computedStyle: { display },
              children: [node({ tag: 'nav', role: 'navigation', computedStyle: { display: 'block' } })],
            }),
            node({ tag: 'nav', role: 'navigation', computedStyle: { display: 'block' } }),
          ],
        }),
      });

    expect(found(page('none'))).toEqual([]);
    expect(found(page('block'))).toEqual(['duplicate-landmark']);
  });

  /**
   * `display` is read off the node's own style, so a hidden *ancestor* is what
   * removes the subtree — which is the shape a utility class actually takes: the
   * wrapper is hidden and the landmark inside it computes as a block.
   */
  it('reports nothing about a control inside a hidden wrapper', () => {
    expect(
      found(
        capture({
          profile: CHROMIUM_PROFILE,
          root: node({
            tag: 'div',
            computedStyle: { display: 'none' },
            children: [node({ tag: 'button', role: 'button', computedStyle: { display: 'block' } })],
          }),
        }),
      ),
    ).toEqual([]);
  });

  /**
   * A structural-only capture computed no style, and a document whose
   * visibility could not be observed is inspected rather than silently emptied.
   */
  it('inspects a node whose display was never observed', () => {
    expect(found(capture({ root: node({ tag: 'button', role: 'button' }) }))).toEqual([
      'control-without-name',
    ]);
  });
});

describe('visible text is assembled the way a name is', () => {
  /**
   * The finding this project reported against its own site, twenty-four times.
   *
   * `<button>Search<kbd>⌘K</kbd></button>` under `display: flex` is named
   * "Search ⌘K" by every browser, because flex blockifies its items and accname
   * separates a non-inline contribution. Reading the visible text with a space
   * and the name without one made the two disagree by construction, so the rule
   * fired on markup a voice command reaches perfectly well.
   */
  it('holds for a flex control whose name carries the separator a browser inserts', () => {
    expect(
      found(
        capture({
          profile: CHROMIUM_PROFILE,
          root: node({
            tag: 'button',
            role: 'button',
            name: 'Search ⌘K',
            computedStyle: { display: 'flex' },
            children: [
              node({ tag: '#text', text: 'Search' }),
              node({ tag: 'kbd', text: '⌘K', computedStyle: { display: 'block' } }),
            ],
          }),
        }),
      ),
    ).toEqual([]);
  });

  /** And an inline child is part of the word it sits inside, not beside it. */
  it('holds for an inline child that is not separated from its sentence', () => {
    expect(
      found(
        capture({
          profile: CHROMIUM_PROFILE,
          root: node({
            tag: 'button',
            role: 'button',
            name: 'Save!',
            computedStyle: { display: 'block' },
            children: [
              node({ tag: '#text', text: 'Save' }),
              node({ tag: 'b', text: '!', computedStyle: { display: 'inline' } }),
            ],
          }),
        }),
      ),
    ).toEqual([]);
  });

  /** The rule still fires when the words genuinely do not appear in the name. */
  it('still reports a control named something the page does not read', () => {
    expect(
      found(
        capture({
          profile: CHROMIUM_PROFILE,
          root: node({
            tag: 'button',
            role: 'button',
            name: 'Submit form',
            computedStyle: { display: 'flex' },
            children: [node({ tag: 'span', text: 'Save', computedStyle: { display: 'block' } })],
          }),
        }),
      ),
    ).toEqual(['label-mismatch']);
  });
});
