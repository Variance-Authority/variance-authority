import { describe, expect, it } from 'vitest';
import { normalize } from './index.js';
import { capture, node } from './fixture.js';

/**
 * These tests are ADR-0003's claims stated as assertions.
 *
 * Every `hash stable` case is a no-op refactor that must not invalidate a
 * baseline; every `hash changes` case is its negative control, present because a
 * normalizer that returns a constant would pass every stability test ever
 * written. M0's exit criterion is decided here.
 *
 * The claim set spans three files, split by what each claim is about. This one
 * holds the tree: what makes two renders *the same structure* — ids, classes,
 * wrappers, text. `normalize-style.test.ts` holds the resolution of declarations
 * into computed style; `normalize-environment.test.ts` holds what the hash is a
 * hash *of*.
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

  it('keeps a wrapper that roots a component boundary', () => {
    // `function Summary() { return <span>{total}</span> }` is most of a component
    // library, and collapsing that span takes the record of what `Summary` was
    // handed with it. The boundary is the anchor `compare/parting.ts` traces a
    // difference back through, so the wrapper stops being inert the moment one
    // is attached — the bargain `ignoredBy` already makes one line above.
    const boundary = node({
      children: [
        node({
          holding: { props: [{ name: 'total', digest: 'v1:0' }] },
          children: [node({ tag: 'span', text: 'hi' })],
        }),
      ],
    });
    const bare = node({ children: [node({ tag: 'span', text: 'hi' })] });

    expect(hashOf(boundary)).not.toBe(hashOf(bare));
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

describe('text', () => {
  it('collapses runs of whitespace, as white-space: normal does', () => {
    expect(hashOf(node({ tag: 'p', text: 'hello   world' }))).toBe(
      hashOf(node({ tag: 'p', text: 'hello world' })),
    );
  });

  it('does not trim, because a boundary space between inline elements renders', () => {
    // Trimming would make `<b>a</b> <i>b</i>` read the same as `<b>a</b><i>b</i>`,
    // which renders as "a b" and "ab" respectively.
    expect(hashOf(node({ tag: 'p', text: 'hello ' }))).not.toBe(
      hashOf(node({ tag: 'p', text: 'hello' })),
    );
  });

  it('can digest text for subjects whose copy is volatile', () => {
    const snapshot = normalize(capture({ root: node({ tag: 'p', text: 'order #48213' }) }), {
      digestText: true,
    });
    expect(snapshot.root.text).toMatch(/^v1:[0-9a-f]{32}$/);
  });
});

describe('recorded source locations', () => {
  const at = (file: string) => node({ tag: 'p', source: { file, line: 12, column: 4 } });
  const sourceOf = (root: ReturnType<typeof node>, options = {}) =>
    normalize(capture({ root }), options).root.provenance?.source;

  it('states a path relative to the root it was told about', () => {
    // What a transform writes is what its module graph holds, which is absolute.
    // A baseline is compared across machines, so an absolute path in one is a
    // home directory published in the repository and a path CI cannot resolve.
    expect(sourceOf(at('/home/ci/work/app/src/ds.jsx'), { sourceRoot: '/home/ci/work/app' })).toEqual(
      { file: 'src/ds.jsx', line: 12, column: 4 },
    );
  });

  it('leaves a path outside that root alone', () => {
    // A linked package or a dependency shipping JSX is genuinely not at a
    // repository-relative path, and `../../..` would resolve nowhere useful.
    const outside = '/home/ci/other/design-system/src/Button.jsx';
    expect(sourceOf(at(outside), { sourceRoot: '/home/ci/work/app' })?.file).toBe(outside);
  });

  it('is not part of what a snapshot is a hash of', () => {
    // Load-bearing: relativizing must be free to change without invalidating
    // every baseline in the repository, and an element that moved down a file is
    // not an element that changed.
    expect(hashOf(at('/home/ci/work/app/src/ds.jsx'), { sourceRoot: '/home/ci/work/app' })).toBe(
      hashOf(at('/elsewhere/src/ds.jsx')),
    );
  });
});

/**
 * Frames, which are a location nobody has paid for yet.
 *
 * React 19 records no location and captures an `Error` instead, so what arrives
 * here is a stack naming the dev server's own URLs. Turning one into a file
 * costs a module fetch, and a run whose subjects all settle has nothing to spend
 * it on — so normalization carries them and `locateSites` spends them later, for
 * the few nodes a region or a finding names.
 *
 * That only works if they are invisible to everything in between, which is what
 * these two assert.
 */
describe('frames a location has not been bought with', () => {
  const frame = { url: 'http://127.0.0.1:5199/src/ds.jsx', line: 23, column: 26, function: 'App' };
  const framed = () => node({ tag: 'p', stack: [frame] });

  it('carries them through, so the demand side has something to spend', () => {
    expect(normalize(capture({ root: framed() })).root.provenance?.stack).toEqual([frame]);
  });

  it('changes no hash by carrying them', () => {
    // The one thing that would make this unsafe. A frame holds a dev server's
    // port, so a hash that admitted one would disagree with itself across a
    // restart — and every baseline in the repository would need re-approving by
    // whoever next ran the suite on a different port.
    expect(hashOf(framed())).toBe(hashOf(node({ tag: 'p' })));
  });
});
