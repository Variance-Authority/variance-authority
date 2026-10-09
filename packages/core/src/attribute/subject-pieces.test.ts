import { describe, expect, it } from 'vitest';
import { UNATTRIBUTED } from './boundary.js';
import type { SubjectComposition } from './composition.js';
import { instance } from './composition-fixture.js';
import { piecesOf } from './subject-pieces.js';

/**
 * Nine subjects, every one inside a `Provider`, so it is structure. A chip
 * story and its twin; a footer story holding the chip; a page holding the
 * footer, the chip as the story renders it and once more selected, a counter, a
 * layout and the header; a header story; a button story; and a subject that
 * mounts nothing but the provider.
 */
function suite(): readonly SubjectComposition[] {
  const subject = (name: string, ...held: readonly [string, string][]): SubjectComposition => ({
    subject: name,
    instances: [['Provider', 'p'] as const, ...held].map(([component, rendering], at) =>
      instance({ component, rendering: `v1:${rendering}`, path: `${at}` }),
    ),
  });
  return [
    subject('chip', ['Chip', 'chip']),
    subject('chip again', ['Chip', 'chip']),
    subject('footer', ['Footer', 'footer'], ['Chip', 'chip']),
    subject('page', ['Layout', 'layout'], ['Footer', 'footer'], ['Chip', 'chip'], ['Chip', 'selected'], ['Counter', 'counter'], ['Header', 'header']),
    subject('header', ['Header', 'header']),
    subject('button', ['Button', 'button']),
    subject('blank'),
    subject('link', ['Link', 'link']),
    subject('badge', ['Badge', 'badge']),
  ];
}

const shares = (rows: readonly { subject: string; footprint: number; shared: number }[]) =>
  rows.map((row) => [row.subject, row.footprint, row.shared]);

describe('a subject read as the narrower subjects inside it', () => {
  it('splits what no piece renders into its own components and components a piece renders another way', () => {
    const page = piecesOf(suite()).get('page');
    expect([page?.footprint, page?.structure, page?.alike]).toEqual([6, 1, []]);
    expect(shares(page?.pieces ?? [])).toEqual([['footer', 2, 2], ['chip', 1, 1], ['chip again', 1, 1], ['header', 1, 1]]);
    expect(page?.wholes).toEqual([]);
    expect(page?.explained).toBe(3);
    expect(page?.own).toEqual([{ component: 'Counter', renderings: 1 }, { component: 'Layout', renderings: 1 }]);
    expect(page?.inContext).toEqual([{ component: 'Chip', renderings: 1, pieces: ['footer', 'chip', 'chip again'] }]);
  });

  it('names the larger subjects holding one, smallest first, and its twin as alike rather than a piece', () => {
    const pieces = piecesOf(suite());
    const chip = pieces.get('chip');
    expect(chip?.alike).toEqual(['chip again']);
    expect(chip?.pieces).toEqual([]);
    expect(shares(chip?.wholes ?? [])).toEqual([['footer', 2, 1], ['page', 6, 1]]);
    expect(chip?.own).toEqual([{ component: 'Chip', renderings: 1 }]);

    const footer = pieces.get('footer');
    expect(shares(footer?.pieces ?? [])).toEqual([['chip', 1, 1], ['chip again', 1, 1]]);
    expect(shares(footer?.wholes ?? [])).toEqual([['page', 6, 2]]);
    expect([footer?.explained, footer?.own, footer?.inContext]).toEqual([1, [{ component: 'Footer', renderings: 1 }], []]);
  });

  it('names subjects alike in the order the suite planned them, not by name', () => {
    const third: SubjectComposition = { ...suite()[0]!, subject: 'chip third' };
    expect(piecesOf([third, ...suite()]).get('chip')?.alike).toEqual(['chip third', 'chip again']);
  });

  it('holds a subject nine tenths inside another as a piece, and eight tenths as neither', () => {
    const subject = (name: string, ...renderings: readonly string[]): SubjectComposition => ({
      subject: name,
      instances: renderings.map((rendering, at) => instance({ component: 'Grid', rendering, path: `${at}` })),
    });
    const tenths = ['0', '1', '2', '3', '4', '5', '6', '7'];
    const pieces = piecesOf([
      ...suite(),
      subject('grid', ...tenths, '8', '9', '10'),
      subject('nine tenths', ...tenths, '8', 'x'),
      subject('eight tenths', ...tenths, 'y', 'z'),
    ]);
    expect(shares(pieces.get('grid')?.pieces ?? [])).toEqual([['nine tenths', 10, 9]]);
    expect(shares(pieces.get('nine tenths')?.wholes ?? [])).toEqual([['grid', 11, 9]]);
    expect([pieces.get('eight tenths')?.pieces, pieces.get('eight tenths')?.wholes]).toEqual([[], []]);
  });

  it('gives a subject that mounts only structure no footprint and nothing beside it', () => {
    const blank = piecesOf(suite()).get('blank');
    expect(blank).toEqual({ footprint: 0, structure: 1, alike: [], pieces: [], wholes: [], explained: 0, own: [], inContext: [] });
  });

  it('leaves out an instance with no component provenance', () => {
    const anonymous: SubjectComposition = { subject: 'anonymous', instances: [instance({ component: UNATTRIBUTED })] };
    expect(piecesOf([anonymous]).get('anonymous')?.footprint).toBe(0);
  });
});
