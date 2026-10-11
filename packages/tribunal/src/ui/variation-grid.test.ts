import type { VariationRecord } from '@variance-authority/report';
import { describe, expect, it } from 'vitest';
import { gridsOf } from './variation-grid.js';

const SALE: VariationRecord = {
  subject: 'story:card--sale',
  parent: 'story:card',
  how: 'named',
  step: { axis: 'promo', position: 0, from: 'none', to: 'sale' },
  because: '',
};
const DARK: VariationRecord = {
  subject: 'story:card--dark',
  parent: 'story:card',
  how: 'named',
  step: { axis: 'scheme', position: 1, from: 'light', to: 'dark' },
  because: '',
};
const SALE_DARK: VariationRecord = {
  subject: 'story:card--sale-dark',
  parent: 'story:card--sale',
  how: 'named',
  step: { axis: 'scheme', position: 1, from: 'light', to: 'dark' },
  because: '',
};

describe('a subject varying on two axes is placed on a grid', () => {
  it('puts the axis the name format writes first down the side and the other across', () => {
    const [grid] = gridsOf([SALE_DARK, DARK, SALE]);

    expect(grid).toEqual({
      root: 'story:card',
      rows: { axis: 'promo', values: ['none', 'sale'] },
      columns: { axis: 'scheme', values: ['light', 'dark'] },
      cells: [
        ['story:card', 'story:card--dark'],
        ['story:card--sale', 'story:card--sale-dark'],
      ],
    });
  });

  it('takes the order from the name format even when no subject combines both axes', () => {
    // With `card--sale` and `card--dark` alone no name shows the order, and a
    // guess would turn the grid over in the run that adds `card--dark-sale`.
    const scheme = (record: VariationRecord): VariationRecord => ({ ...record, step: { ...record.step!, position: 0 } });
    const promo = (record: VariationRecord): VariationRecord => ({ ...record, step: { ...record.step!, position: 1 } });
    const [grid] = gridsOf([promo(SALE), scheme(DARK)]);

    expect(grid?.rows.axis).toBe('scheme');
    expect(grid?.columns.axis).toBe('promo');
  });

  it('leaves the cell nobody rendered empty, since a list of pairs cannot show it missing', () => {
    const [grid] = gridsOf([DARK, SALE]);

    expect(grid?.cells).toEqual([
      ['story:card', 'story:card--dark'],
      ['story:card--sale', undefined],
    ]);
  });

  it('draws no grid for one axis, which a pair already shows', () => {
    expect(gridsOf([SALE])).toEqual([]);
  });

  it('draws no grid for three axes, which no flat grid shows honestly', () => {
    const wide: VariationRecord = {
      subject: 'story:card--narrow',
      parent: 'story:card',
      how: 'named',
      step: { axis: 'width', position: 2, from: 'wide', to: 'narrow' },
      because: '',
    };

    expect(gridsOf([SALE, DARK, wide])).toEqual([]);
  });

  it('draws no grid when a link has no step, since that subject has no coordinate', () => {
    // A declared pair is a statement about two subjects, not a place on an axis.
    const declared: VariationRecord = { subject: 'story:card--sale-dark', parent: 'story:card--sale', because: '' };

    expect(gridsOf([SALE, DARK, declared])).toEqual([]);
  });

  it('draws no grid when two subjects claim one cell, rather than choose between them', () => {
    const twin: VariationRecord = { ...DARK, subject: 'story:card--night' };

    expect(gridsOf([SALE, DARK, twin])).toEqual([]);
  });

  it('places each root on its own grid', () => {
    const other = (record: VariationRecord): VariationRecord => ({
      ...record,
      subject: record.subject.replace('card', 'tile'),
      ...(record.parent === undefined ? {} : { parent: record.parent.replace('card', 'tile') }),
    });

    expect(gridsOf([SALE, DARK, other(SALE), other(DARK)]).map((grid) => grid.root)).toEqual([
      'story:card',
      'story:tile',
    ]);
  });

  it('draws no grid for links that loop, since a loop has no corner to start from', () => {
    // Two names each read as the other's parent is a run with no base, and
    // any cell picked for its corner would be a guess.
    const loop = (subject: string, parent: string, axis: string): VariationRecord => ({
      subject,
      parent,
      how: 'named',
      step: { axis, position: 0, from: 'base', to: 'arm' },
      because: '',
    });
    const looped = [loop('story:tile--a', 'story:tile--b', 'promo'), loop('story:tile--b', 'story:tile--a', 'scheme')];

    expect(gridsOf([SALE, DARK, SALE_DARK, ...looped]).map((grid) => grid.root)).toEqual(['story:card']);
  });
});
