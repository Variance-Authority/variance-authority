import { describe, expect, it } from 'vitest';
import { normalize } from '../rules/normalize/index.js';
import { diffSnapshots } from '../compare/diff/index.js';
import { capture, node } from '../rules/normalize/fixture.js';
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
