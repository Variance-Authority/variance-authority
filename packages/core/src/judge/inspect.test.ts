import { describe, expect, it } from 'vitest';
import { normalize } from '../rules/normalize/index.js';
import { diffSnapshots } from '../compare/diff/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../rules/normalize/fixture.js';
import { inspect, summarizeFindings, type FindingRule } from './inspect.js';
import type { RawCapture } from '../format/capture.js';

const found = (raw: RawCapture): readonly FindingRule[] =>
  inspect(normalize(raw)).map((finding) => finding.rule);

describe('what one snapshot says on its own', () => {
  /**
   * The property the whole module exists for. A comparison needs two of
   * something, so a defect present on the *first* run is invisible to it
   * forever: the button compares equal to itself every time, and approving the
   * first baseline approves the defect along with it.
   */
  it('reports a defect that a comparison against itself never could', () => {
    const broken = () => capture({ root: node({ tag: 'button', role: 'button' }) });
    const comparison = diffSnapshots(normalize(broken()), normalize(broken()));

    // The comparison is right, and useless. Nothing changed, so nothing is
    // reported, and this holds for every run until somebody edits the button.
    expect(comparison.identical).toBe(true);
    expect(comparison.deltas).toEqual([]);

    expect(found(broken())).toEqual(['control-without-name']);
  });

  it('finds nothing in a subject with nothing wrong', () => {
    const clean = capture({
      root: node({
        tag: 'section',
        children: [
          node({ tag: 'h2', role: 'heading', name: 'Settings', text: 'Settings' }),
          node({ tag: 'button', role: 'button', name: 'Save', text: 'Save' }),
          node({ tag: 'img', role: 'img', attributes: { alt: '' } }),
        ],
      }),
    });

    expect(inspect(normalize(clean))).toEqual([]);
  });
});

describe('control-without-name', () => {
  it('names the tag and the role, not the rule', () => {
    const findings = inspect(
      normalize(capture({ root: node({ tag: 'a', role: 'link', attributes: { href: '/x' } }) })),
    );

    expect(findings[0]?.what).toBe('<a> is a link with no accessible name');
    expect(findings[0]?.band).toBe('a11y');
  });

  it('holds for a control that has one', () => {
    expect(found(capture({ root: node({ tag: 'button', role: 'button', name: 'Save' }) }))).toEqual(
      [],
    );
  });

  /** Non-interactive roles are not controls, however unnamed they are. */
  it('does not report an unnamed paragraph', () => {
    expect(found(capture({ root: node({ tag: 'p', role: 'paragraph', text: 'hi' }) }))).toEqual([]);
  });
});

describe('image-without-alt', () => {
  it('reports an image with neither a name nor an explicit alt', () => {
    expect(found(capture({ root: node({ tag: 'img', role: 'img' }) }))).toEqual([
      'image-without-alt',
    ]);
  });

  /**
   * `alt=""` is the author answering the question — "this image carries no
   * meaning" — and a rule that reports a correct answer is a rule teams disable.
   * Both spellings produce no accessible name, so the attribute is the only
   * thing that separates a decorative image from a forgotten one.
   */
  it('holds for a decorative image, which is an answer and not an omission', () => {
    expect(found(capture({ root: node({ tag: 'img', role: 'img', attributes: { alt: '' } }) }))).toEqual([]);
  });
});

describe('heading-level-skipped', () => {
  const heading = (tag: string, name: string) => node({ tag, role: 'heading', name, text: name });

  it('reports a jump of more than one level', () => {
    const findings = inspect(
      normalize(
        capture({
          root: node({
            tag: 'section',
            children: [heading('h2', 'Account'), heading('h4', 'Billing')],
          }),
        }),
      ),
    );

    expect(findings.map((f) => f.rule)).toEqual(['heading-level-skipped']);
    expect(findings[0]?.what).toContain('from 2 to 4');
  });

  /**
   * A subject is a component, not a page. A card that renders its title as `h3`
   * because it is used inside a section is correct, and a rule that demanded
   * every subject start at `h1` would fire on every component library.
   */
  it('does not require a subject to start at h1', () => {
    expect(found(capture({ root: heading('h3', 'Card') }))).toEqual([]);
  });

  it('does not report going back up', () => {
    expect(
      found(
        capture({
          root: node({
            tag: 'section',
            children: [heading('h2', 'A'), heading('h3', 'B'), heading('h2', 'C')],
          }),
        }),
      ),
    ).toEqual([]);
  });

  it('prefers aria-level to the tag, because that is what is announced', () => {
    expect(
      found(
        capture({
          root: node({
            tag: 'section',
            children: [
              heading('h2', 'A'),
              node({ tag: 'h6', role: 'heading', name: 'B', state: { level: 3 } }),
            ],
          }),
        }),
      ),
    ).toEqual([]);
  });
});

describe('nested-interactive', () => {
  it('reports a button inside a link', () => {
    const findings = inspect(
      normalize(
        capture({
          root: node({
            tag: 'a',
            role: 'link',
            name: 'Open',
            children: [node({ tag: 'button', role: 'button', name: 'Dismiss' })],
          }),
        }),
      ),
    );

    expect(findings.map((f) => f.rule)).toEqual(['nested-interactive']);
  });
});

describe('dangling-reference', () => {
  /**
   * The corpus calls `break-association/field` its single most important case,
   * and it needs a baseline to catch: the label and the input are unchanged, so
   * only a comparison against the render where the association worked reports
   * it. This rule reports the same defect from the broken render alone.
   */
  it('reports a label pointing at an element that is not here', () => {
    const findings = inspect(
      normalize(
        capture({
          root: node({
            tag: 'div',
            children: [
              node({ tag: 'label', text: 'Email', attributes: { for: 'gone' } }),
              node({ tag: 'input', attributes: { id: 'email-1', type: 'email' } }),
            ],
          }),
        }),
      ),
    );

    expect(findings.map((f) => f.rule)).toContain('dangling-reference');
  });

  it('holds when the reference resolves', () => {
    expect(
      found(
        capture({
          root: node({
            tag: 'div',
            children: [
              node({ tag: 'label', text: 'Email', attributes: { for: 'email-1' } }),
              node({
                tag: 'input',
                role: 'textbox',
                name: 'Email',
                attributes: { id: 'email-1', type: 'email' },
              }),
            ],
          }),
        }),
      ),
    ).toEqual([]);
  });
});

describe('label-mismatch', () => {
  /**
   * WCAG 2.5.3. The failure is silent for everyone except the person using
   * voice control, for whom the button simply does not exist.
   */
  it('reports a control whose name does not contain what it reads', () => {
    const findings = inspect(
      normalize(
        capture({ root: node({ tag: 'button', role: 'button', name: 'Submit form', text: 'Save' }) }),
      ),
    );

    expect(findings.map((f) => f.rule)).toEqual(['label-mismatch']);
    expect(findings[0]?.what).toContain('"Save"');
  });

  /** A name that *extends* the visible text is correct and common. */
  it('holds when the name contains the visible label', () => {
    expect(
      found(
        capture({
          root: node({ tag: 'button', role: 'button', name: 'Save changes to draft', text: 'Save' }),
        }),
      ),
    ).toEqual([]);
  });

  /**
   * The case that decides whether the rule is usable. Every design system has
   * icon buttons, and a rule that reported all of them would be switched off
   * before it found anything.
   */
  it('holds for an icon button, whose glyph is hidden and is not a label', () => {
    expect(
      found(
        capture({
          root: node({
            tag: 'button',
            role: 'button',
            name: 'Refresh',
            children: [node({ tag: 'span', state: { hidden: true }, text: '↻' })],
          }),
        }),
      ),
    ).toEqual([]);
  });
});

describe('duplicate-landmark', () => {
  const nav = (name?: string) =>
    node({ tag: 'nav', role: 'navigation', ...(name !== undefined ? { name } : {}) });

  it('reports two landmarks of one role that nothing tells apart', () => {
    expect(found(capture({ root: node({ tag: 'div', children: [nav(), nav()] }) }))).toEqual([
      'duplicate-landmark',
    ]);
  });

  /** Two named navigations are how a page is meant to be built. */
  it('holds when the two carry different names', () => {
    expect(
      found(capture({ root: node({ tag: 'div', children: [nav('Primary'), nav('Footer')] }) })),
    ).toEqual([]);
  });
});

describe('table-without-headers', () => {
  const cell = (text: string) => node({ tag: 'td', role: 'cell', text });

  it('reports a table whose cells are announced without their columns', () => {
    expect(
      found(
        capture({
          root: node({
            tag: 'table',
            role: 'table',
            children: [
              node({ tag: 'tr', role: 'row', children: [cell('2,400'), cell('900')] }),
            ],
          }),
        }),
      ),
    ).toEqual(['table-without-headers']);
  });

  it('holds when a header cell exists anywhere in it', () => {
    expect(
      found(
        capture({
          root: node({
            tag: 'table',
            role: 'table',
            children: [
              node({
                tag: 'tr',
                role: 'row',
                children: [node({ tag: 'th', role: 'columnheader', name: 'Amount', text: 'Amount' })],
              }),
              node({ tag: 'tr', role: 'row', children: [cell('2,400')] }),
            ],
          }),
        }),
      ),
    ).toEqual([]);
  });
});

describe('positive-tabindex', () => {
  it('reports a tabindex that reorders focus for the whole document', () => {
    expect(
      found(capture({ root: node({ tag: 'div', attributes: { tabindex: '3' } }) })),
    ).toEqual(['positive-tabindex']);
  });

  /** `0` and `-1` are the two ordinary, correct values and must stay silent. */
  it('holds for tabindex 0 and -1', () => {
    for (const value of ['0', '-1']) {
      expect(found(capture({ root: node({ tag: 'div', attributes: { tabindex: value } }) }))).toEqual(
        [],
      );
    }
  });
});

describe('attribution', () => {
  it('names the component that wrote the JSX, and orients the finding', () => {
    const findings = inspect(
      normalize(
        capture({
          root: node({
            tag: 'nav',
            role: 'navigation',
            name: 'Main',
            children: [node({ tag: 'button', role: 'button', owners: [{ name: 'IconButton' }] })],
          }),
        }),
      ),
    );

    expect(findings[0]?.component).toBe('IconButton');
    expect(findings[0]?.where).toContain('navigation');
  });
});

describe('the report a reader is handed', () => {
  it('counts by rule and puts the file on its own line', () => {
    const findings = inspect(
      normalize(
        capture({
          root: node({ tag: 'button', role: 'button', owners: [{ name: 'IconButton' }] }),
        }),
      ),
    );

    const text = summarizeFindings(findings, {
      source: { IconButton: [{ file: 'src/ui/IconButton.tsx', line: 12 }] },
    });

    expect(text).toContain('1 finding: 1 control-without-name');
    expect(text).toContain('IconButton src/ui/IconButton.tsx:12');
  });

  it('says so plainly when there is nothing', () => {
    expect(summarizeFindings([])).toBe('no findings.');
  });
});

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
