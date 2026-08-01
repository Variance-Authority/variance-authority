import { describe, expect, it } from 'vitest';
import { normalize } from './index.js';
import { CHROMIUM_PROFILE, capture, node } from './fixture.js';

/**
 * These tests are ADR-0003's claims stated as assertions.
 *
 * Every `hash stable` case is a no-op refactor that must not invalidate a
 * baseline; every `hash changes` case is its negative control, present because a
 * normalizer that returns a constant would pass every stability test ever
 * written. M0's exit criterion is decided here.
 */

const hashOf = (root: ReturnType<typeof node>, options = {}): string =>
  normalize(capture({ root }), options).renderHash;

describe('structural id aliasing', () => {
  const form = (idSuffix: string) =>
    node({
      children: [
        node({
          tag: 'label',
          attributes: { for: `input-${idSuffix}` },
          text: 'Email',
        }),
        node({
          tag: 'input',
          attributes: {
            id: `input-${idSuffix}`,
            type: 'email',
            'aria-describedby': `help-${idSuffix}`,
          },
        }),
        node({ tag: 'p', attributes: { id: `help-${idSuffix}` }, text: 'We never share it.' }),
      ],
    });

  it('survives a useId renumbering', () => {
    // Mounting an unrelated component earlier shifts React's id counter and
    // renumbers every id on the page. Nothing a user can perceive changed.
    expect(hashOf(form(':r0:'))).toBe(hashOf(form(':r7:')));
  });

  it('still records the association it aliased', () => {
    const snapshot = normalize(capture({ root: form(':r0:') }));
    const label = snapshot.root.children[0]!;
    const input = snapshot.root.children[1]!;

    expect(label.attributes['for']).toBe(input.alias);
    expect(input.alias).toBe('#a0');
  });

  it('detects a broken label association that masking would have hidden', () => {
    const broken = node({
      children: [
        node({ tag: 'label', attributes: { for: 'nonexistent' }, text: 'Email' }),
        node({ tag: 'input', attributes: { id: 'input-1', type: 'email' } }),
        node({ tag: 'p', attributes: { id: 'help-1' }, text: 'We never share it.' }),
      ],
    });

    expect(hashOf(broken)).not.toBe(hashOf(form('1')));
  });

  it('flags a reference escaping the subject rather than normalizing it away', () => {
    const escaping = node({
      children: [node({ tag: 'input', attributes: { 'aria-describedby': 'somewhere-else' } })],
    });

    const snapshot = normalize(capture({ root: escaping }));
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'dangling-id-reference' }),
    );
  });

  it('aliases url(#…) fragments inside style values', () => {
    const filtered = (suffix: string) =>
      node({
        children: [
          node({ attributes: { id: `blur-${suffix}` } }),
          node({ rules: [{ selector: '.x', declare: { filter: `url(#blur-${suffix})` } }] }),
        ],
      });

    expect(hashOf(filtered('7'))).toBe(hashOf(filtered('9')));
  });
});

describe('class attributes', () => {
  it('ignores hashed class-name churn entirely', () => {
    // CSS-in-JS regenerates the hash when any declaration in the file changes,
    // including in an unrelated rule.
    const styled = (hash: string) =>
      node({
        attributes: { class: `css-${hash}` },
        rules: [{ selector: `.css-${hash}`, declare: { color: '#f00' } }],
      });

    expect(hashOf(styled('1a2b3c'))).toBe(hashOf(styled('9z8y7x')));
  });

  it('never emits a class attribute', () => {
    const snapshot = normalize(
      capture({ root: node({ attributes: { class: 'btn btn-primary', type: 'button' } }) }),
    );
    expect(snapshot.root.attributes).not.toHaveProperty('class');
    expect(snapshot.root.attributes['type']).toBe('button');
  });

  it('drops framework bookkeeping attributes it was never told about', () => {
    const snapshot = normalize(
      capture({
        root: node({
          attributes: { 'data-reactroot': '', 'data-styled': 'true', 'data-v-7f3a': '' },
        }),
      }),
    );
    expect(Object.keys(snapshot.root.attributes)).toHaveLength(0);
  });
});

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

describe('wrapper collapse', () => {
  it('collapses an inert div chain', () => {
    const wrapped = node({
      children: [node({ children: [node({ children: [node({ tag: 'span', text: 'hi' })] })] })],
    });
    const bare = node({ children: [node({ tag: 'span', text: 'hi' })] });

    expect(hashOf(wrapped)).toBe(hashOf(bare));
  });

  it('keeps a wrapper that establishes a layout context', () => {
    const flex = node({
      children: [
        node({
          rules: [{ selector: '.row', declare: { display: 'flex' } }],
          children: [node({ tag: 'span', text: 'hi' })],
        }),
      ],
    });
    const bare = node({ children: [node({ tag: 'span', text: 'hi' })] });

    expect(hashOf(flex)).not.toBe(hashOf(bare));
  });

  it('keeps a wrapper carrying a role', () => {
    const landmark = node({
      children: [node({ role: 'navigation', children: [node({ tag: 'span', text: 'hi' })] })],
    });
    const bare = node({ children: [node({ tag: 'span', text: 'hi' })] });

    expect(hashOf(landmark)).not.toBe(hashOf(bare));
  });

  it('keeps a wrapper that is a referenced id target', () => {
    const target = node({
      children: [
        node({ attributes: { id: 'panel' }, children: [node({ tag: 'span', text: 'hi' })] }),
      ],
    });
    const bare = node({ children: [node({ tag: 'span', text: 'hi' })] });

    expect(hashOf(target)).not.toBe(hashOf(bare));
  });

  it('repaths promoted children so paths describe the final tree', () => {
    const snapshot = normalize(
      capture({
        root: node({
          children: [
            node({ children: [node({ tag: 'span', text: 'a' }), node({ tag: 'span', text: 'b' })] }),
          ],
        }),
      }),
    );

    expect(snapshot.root.children.map((child) => child.path)).toEqual(['0/0', '0/1']);
  });

  it('can be switched off', () => {
    const wrapped = node({ children: [node({ children: [node({ tag: 'span', text: 'hi' })] })] });
    expect(hashOf(wrapped, { collapseWrappers: false })).not.toBe(hashOf(wrapped));
  });
});

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

describe('text', () => {
  it('collapses whitespace the renderer would have collapsed anyway', () => {
    const spaced = node({ tag: 'p', text: '  hello   world  ' });
    const tight = node({ tag: 'p', text: 'hello world' });
    expect(hashOf(spaced)).toBe(hashOf(tight));
  });

  it('can digest text for subjects whose copy is volatile', () => {
    const snapshot = normalize(capture({ root: node({ tag: 'p', text: 'order #48213' }) }), {
      digestText: true,
    });
    expect(snapshot.root.text).toMatch(/^v1:[0-9a-f]{32}$/);
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
