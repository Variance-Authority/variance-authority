import { describe, expect, it } from 'vitest';
import { normalize } from './index.js';
import { capture, node } from './fixture.js';

/**
 * ADR-0003's claims about turning declarations into computed style.
 *
 * Split from `normalize.test.ts` because these are all one question — given the
 * rules that matched a node, what value does it end up with — and answering it
 * takes the four stages that live here: canonicalizing values, expanding
 * shorthands, resolving the cascade, and resolving `var()`. Provenance rides
 * along because it records *which rule won*, which is the cascade's own output
 * held outside the hash.
 *
 * The same discipline as the parent file: every `hash stable` case is a no-op
 * refactor that must not invalidate a baseline, and every `hash changes` case is
 * its negative control.
 */

const hashOf = (root: ReturnType<typeof node>, options = {}): string =>
  normalize(capture({ root }), options).renderHash;

describe('value canonicalization', () => {
  const colored = (value: string) =>
    node({ rules: [{ selector: '.x', declare: { color: value } }] });

  it('collapses every sRGB spelling of one colour', () => {
    const canonical = hashOf(colored('red'));
    for (const spelling of ['#f00', '#ff0000', 'rgb(255,0,0)', 'rgb(255 0 0)', 'hsl(0,100%,50%)']) {
      expect(hashOf(colored(spelling))).toBe(canonical);
    }
  });

  it('still separates two genuinely different colours', () => {
    expect(hashOf(colored('#f00'))).not.toBe(hashOf(colored('#f01')));
  });

  it('converts absolute units to px', () => {
    const sized = (value: string) =>
      node({ rules: [{ selector: '.x', declare: { 'font-size': value } }] });
    expect(hashOf(sized('12pt'))).toBe(hashOf(sized('16px')));
    expect(hashOf(sized('1in'))).toBe(hashOf(sized('96px')));
  });

  it('leaves relative units symbolic, because this tier cannot resolve them', () => {
    const snapshot = normalize(
      capture({ root: node({ rules: [{ selector: '.x', declare: { padding: '1rem' } }] }) }),
    );
    expect(snapshot.root.style['padding-top']).toBe('1rem');
  });

  it('treats zero as unitless however it was written', () => {
    const inset = (value: string) =>
      node({ rules: [{ selector: '.x', declare: { 'margin-top': value } }] });
    expect(hashOf(inset('0'))).toBe(hashOf(inset('0px')));
    expect(hashOf(inset('0'))).toBe(hashOf(inset('0em')));
  });

  it('is insensitive to whitespace and keyword casing', () => {
    const shadowed = (value: string) =>
      node({ rules: [{ selector: '.x', declare: { display: value } }] });
    expect(hashOf(shadowed('  BLOCK '))).toBe(hashOf(shadowed('block')));
  });
});

describe('shorthand expansion', () => {
  it('treats a shorthand and its longhands as the same declaration', () => {
    const short = node({ rules: [{ selector: '.x', declare: { margin: '4px 8px' } }] });
    const long = node({
      rules: [
        {
          selector: '.x',
          declare: {
            'margin-top': '4px',
            'margin-right': '8px',
            'margin-bottom': '4px',
            'margin-left': '8px',
          },
        },
      ],
    });

    expect(hashOf(short)).toBe(hashOf(long));
  });

  it('expands border into all three components on all four sides', () => {
    const snapshot = normalize(
      capture({ root: node({ rules: [{ selector: '.x', declare: { border: '1px solid red' } }] }) }),
    );
    expect(snapshot.root.style['border-top-width']).toBe('1px');
    expect(snapshot.root.style['border-left-style']).toBe('solid');
    expect(snapshot.root.style['border-bottom-color']).toBe('rgb(255 0 0 / 1)');
  });

  it('resets omitted components rather than leaving them unobserved', () => {
    // `border: solid` really does reset width and colour. Recording only the
    // style would let a genuine colour change pass as unchanged.
    const snapshot = normalize(
      capture({ root: node({ rules: [{ selector: '.x', declare: { border: 'solid' } }] }) }),
    );
    expect(snapshot.root.style['border-top-width']).toBe('medium');
    expect(snapshot.root.style['border-top-color']).toBe('currentcolor');
  });

  it('keeps an unexpandable shorthand rather than dropping its value', () => {
    // `font`'s grammar is ambiguous to decompose, so it is not decomposed — but
    // it must still reach the hash, or a font change would read as `unchanged`.
    const a = node({ rules: [{ selector: '.x', declare: { font: 'bold 12px/1.5 serif' } }] });
    const b = node({ rules: [{ selector: '.x', declare: { font: 'bold 14px/1.5 serif' } }] });

    expect(hashOf(a)).not.toBe(hashOf(b));
  });

  it('does not split a value inside a function call', () => {
    const snapshot = normalize(
      capture({
        root: node({ rules: [{ selector: '.x', declare: { margin: 'calc(1px + 2px) 0' } }] }),
      }),
    );
    expect(snapshot.root.style['margin-top']).toBe('calc(1px + 2px)');
    expect(snapshot.root.style['margin-right']).toBe('0');
  });
});

describe('cascade resolution', () => {
  it('ignores a declaration that loses', () => {
    const contested = node({
      rules: [
        { selector: '.a', declare: { color: 'blue' }, specificity: [0, 1, 0], order: 0 },
        { selector: '#b', declare: { color: 'red' }, specificity: [1, 0, 0], order: 1 },
      ],
    });
    const uncontested = node({
      rules: [{ selector: '#b', declare: { color: 'red' }, specificity: [1, 0, 0], order: 1 }],
    });

    expect(hashOf(contested)).toBe(hashOf(uncontested));
  });

  it('survives a specificity war that does not change the winning value', () => {
    const before = node({
      rules: [
        { selector: '.a', declare: { color: 'red' }, specificity: [0, 1, 0], order: 0 },
        { selector: '.b', declare: { color: 'blue' }, specificity: [0, 1, 0], order: 1 },
        { selector: '.b', declare: { color: 'red' }, specificity: [0, 2, 0], order: 2 },
      ],
    });
    const after = node({
      rules: [{ selector: '.a', declare: { color: 'red' }, specificity: [0, 1, 0], order: 0 }],
    });

    expect(hashOf(before)).toBe(hashOf(after));
  });

  it('honours !important over higher specificity', () => {
    const snapshot = normalize(
      capture({
        root: node({
          rules: [
            { selector: '#b', declare: { color: 'red' }, specificity: [1, 0, 0], order: 1 },
            {
              selector: '.a',
              declare: { color: 'blue' },
              specificity: [0, 1, 0],
              order: 0,
              important: true,
            },
          ],
        }),
      }),
    );
    expect(snapshot.root.style['color']).toBe('rgb(0 0 255 / 1)');
  });

  it('lets inline style beat any selector', () => {
    const snapshot = normalize(
      capture({
        root: node({
          rules: [{ selector: '#b', declare: { color: 'red' }, specificity: [1, 0, 0] }],
          inlineStyle: { color: 'green' },
        }),
      }),
    );
    expect(snapshot.root.style['color']).toBe('rgb(0 128 0 / 1)');
  });

  it('inherits down the tree, so a container colour reaches its text', () => {
    const snapshot = normalize(
      capture({
        root: node({
          rules: [{ selector: '.page', declare: { color: 'red' } }],
          children: [node({ tag: 'span', text: 'hello' })],
        }),
      }),
    );
    expect(snapshot.root.children[0]!.style['color']).toBe('rgb(255 0 0 / 1)');
  });

  it('does not inherit a non-inheritable property', () => {
    const snapshot = normalize(
      capture({
        root: node({
          rules: [{ selector: '.page', declare: { 'background-color': 'red' } }],
          children: [node({ tag: 'span', text: 'hello' })],
        }),
      }),
    );
    expect(snapshot.root.children[0]!.style).not.toHaveProperty('background-color');
  });
});

describe('custom properties and token attribution', () => {
  const themed = (primary: string) =>
    capture({
      root: node({
        rules: [{ selector: ':root', declare: { '--color-primary': primary } }],
        children: [
          node({ tag: 'button', rules: [{ selector: '.btn', declare: { color: 'var(--color-primary)' } }] }),
          node({ tag: 'a', rules: [{ selector: '.link', declare: { color: 'var(--color-primary)' } }] }),
        ],
      }),
    });

  it('resolves var() through the inherited custom-property scope', () => {
    const snapshot = normalize(themed('#0000ff'));
    expect(snapshot.root.children[0]!.style['color']).toBe('rgb(0 0 255 / 1)');
  });

  it('records the token name beside the resolved value', () => {
    // The name is what lets one token edit collapse into one docket root with
    // counted collateral, instead of N unrelated colour diffs.
    const snapshot = normalize(themed('#0000ff'));
    expect(snapshot.root.children[0]!.tokens).toEqual({ '--color-primary': 'rgb(0 0 255 / 1)' });
    expect(snapshot.root.children[1]!.tokens).toEqual({ '--color-primary': 'rgb(0 0 255 / 1)' });
  });

  it('changes the hash when the token value changes', () => {
    expect(normalize(themed('#0000ff')).renderHash).not.toBe(
      normalize(themed('#ff0000')).renderHash,
    );
  });

  it('leaves structure untouched by a pure token change', () => {
    // "1 token change, N collateral, structure intact" — the docket sentence,
    // made checkable.
    expect(normalize(themed('#0000ff')).structureHash).toBe(
      normalize(themed('#ff0000')).structureHash,
    );
    expect(normalize(themed('#0000ff')).styleHash).not.toBe(
      normalize(themed('#ff0000')).styleHash,
    );
  });

  it('uses the fallback when a custom property is undeclared', () => {
    const snapshot = normalize(
      capture({
        root: node({ rules: [{ selector: '.x', declare: { color: 'var(--missing, #00ff00)' } }] }),
      }),
    );
    expect(snapshot.root.style['color']).toBe('rgb(0 255 0 / 1)');
  });

  it('terminates on a circular custom-property reference', () => {
    const circular = capture({
      root: node({
        rules: [
          { selector: ':root', declare: { '--a': 'var(--b)', '--b': 'var(--a)' } },
          { selector: '.x', declare: { color: 'var(--a)' } },
        ],
      }),
    });
    expect(() => normalize(circular)).not.toThrow();
  });
});

describe('style provenance', () => {
  it('names the rule that won, outside the hash', () => {
    const snapshot = normalize(
      capture({
        root: node({
          rules: [{ selector: '.card', declare: { 'padding-top': '12px' }, sheet: 'tokens.css' }],
        }),
      }),
    );

    expect(snapshot.styleProvenance).toContainEqual(
      expect.objectContaining({ property: 'padding-top', sheet: 'tokens.css', selector: '.card' }),
    );
  });

  it('replaces generated selector segments with a placeholder', () => {
    const snapshot = normalize(
      capture({
        root: node({ rules: [{ selector: '.css-1a2b3c', declare: { color: 'red' } }] }),
      }),
    );

    expect(snapshot.styleProvenance[0]!.selector).toBe('.«generated»');
  });

  it('does not let a rule moving between files invalidate a baseline', () => {
    const from = (sheet: string) =>
      node({ rules: [{ selector: '.card', declare: { 'padding-top': '12px' }, sheet }] });

    expect(hashOf(from('old.css'))).toBe(hashOf(from('new.css')));
  });
});
