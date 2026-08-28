import { describe, expect, it } from 'vitest';
import { capture, node } from '../rules/normalize/fixture.js';
import { normalize } from '../rules/normalize/index.js';
import { boundarySnapshot } from './instance.js';
import { partingOf } from './parting.js';

/**
 * Reading one component out of the page it was found in.
 *
 * The two properties this has to hold at once, and they pull against each other.
 * A lifted instance must compare *equal* to the same instance lifted out of a
 * different page — otherwise the echo, which is the cheapest finding in the
 * system, breaks the moment anything is lifted. And it must compare *unequal*
 * when the page decided something about it, which is the only reason to lift.
 */

/** A price, inside a card that decides the text colour it never declares. */
const page = (options: { readonly subject: string; readonly color: string; readonly extra?: string }) =>
  normalize(
    capture({
      subjectId: options.subject,
      inheritedSeed: { color: options.color },
      root: node({
        tag: 'div',
        owners: [{ name: 'Card' }],
        children: [
          ...(options.extra === undefined
            ? []
            : [node({ tag: 'h2', text: options.extra, owners: [{ name: 'Heading' }, { name: 'Card' }] })]),
          node({
            tag: 'span',
            text: '$12.00',
            owners: [{ name: 'Price' }, { name: 'Card' }],
            rules: [{ selector: '.price', declare: { 'font-weight': '600' } }],
          }),
        ],
      }),
    }),
  );

const priceIn = (page: ReturnType<typeof normalize>, path: string) => boundarySnapshot(page, path);

describe('a component instance read as a whole subject', () => {
  it('re-roots the boundary and drops the containers above it', () => {
    const lifted = priceIn(page({ subject: 'receipt', color: '#111111' }), '0/0')!;

    expect(lifted.root.path).toBe('0');
    expect(lifted.root.provenance?.owners.map((owner) => owner.name)).toEqual(['Price']);
  });

  it('is undefined for a path the subject does not have', () => {
    expect(priceIn(page({ subject: 'receipt', color: '#111111' }), '0/9')).toBeUndefined();
  });

  it('reads the same in two pages that agree about it, and only about it', () => {
    // The echo, and the reason the render hash is recomputed rather than
    // inherited from the subject. Two pages that share nothing but this one
    // component still share this one component; carrying the subject's hash down
    // would make every lifted instance unique and the finding unreachable.
    const alone = priceIn(page({ subject: 'price', color: '#111111' }), '0/0')!;
    const inPage = priceIn(page({ subject: 'receipt', color: '#111111', extra: 'Receipt' }), '0/1')!;

    expect(inPage.renderHash).toBe(alone.renderHash);
    expect(partingOf(alone, inPage).identical).toBe(true);
  });

  it('parts when the page decided something the component never declares', () => {
    const light = priceIn(page({ subject: 'receipt', color: '#111111' }), '0/0')!;
    const dark = priceIn(page({ subject: 'promo', color: '#ffffff' }), '0/0')!;

    expect(dark.renderHash).not.toBe(light.renderHash);
    expect(partingOf(light, dark).deltas.length).toBeGreaterThan(0);
  });

  it('keeps the style provenance that belongs to the subtree, rebased', () => {
    const lifted = priceIn(page({ subject: 'receipt', color: '#111111', extra: 'Receipt' }), '0/1')!;

    expect(lifted.styleProvenance.every((entry) => entry.path === '0' || entry.path.startsWith('0/'))).toBe(
      true,
    );
    expect(lifted.styleProvenance.some((entry) => entry.property === 'font-weight')).toBe(true);
  });
});
