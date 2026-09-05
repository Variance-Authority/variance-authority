import { describe, expect, it } from 'vitest';
import { forksOf, treeOf } from './journey-tree.js';
import type { JourneyFamily, JourneyRow } from './journeys.js';

/**
 * The tree, held to what a reader takes from the picture: the trunk is the
 * lattice's root and runs level, an arm leaves at the first fork that divides
 * its bundle and not before, and two rows the family answered alike are one
 * fork. The failure that reads as a working picture is a second numbered mark
 * for the same divergence, with nothing forking at it.
 */

const CONTROL = { subject: 'story:product-card--control', member: 'control' };
const SALE = { subject: 'story:product-card--sale', member: 'sale', from: 'control' };
const DARK = { subject: 'story:product-card--control-dark', member: 'control-dark', from: 'control' };

function row(name: string, line: number, cells: JourneyRow['cells']): JourneyRow {
  return {
    file: 'app/src/components/ProductCard.tsx',
    region: { kind: 'branch', name, startLine: line, endLine: line, entered: [], missed: [] },
    cells,
  };
}

function family(rows: readonly JourneyRow[]): JourneyFamily {
  return { name: 'story:product-card', columns: [CONTROL, DARK, SALE], rows };
}

describe('forks', () => {
  it('folds rows the family answered alike into one fork, in source order', () => {
    const forks = forksOf([
      row('price', 10, ['missed', 'missed', 'entered']),
      row('badge', 12, ['missed', 'entered', 'missed']),
      row('price/label', 11, ['missed', 'missed', 'entered']),
    ]);

    expect(forks.map((fork) => fork.rows.map((r) => r.region?.name))).toEqual([
      ['price', 'price/label'],
      ['badge'],
    ]);
  });
});

describe('the tree', () => {
  it('is one level line when the family took one path', () => {
    const tree = treeOf(family([]), []);

    expect(tree.leaves).toBe(1);
    expect(tree.root).toMatchObject({ from: -1, at: 0, main: true, y: 0, branches: [] });
    expect(tree.root.stories).toEqual([CONTROL, DARK, SALE]);
  });

  it('keeps the trunk level and forks the arm that entered off it', () => {
    const rows = [row('price', 10, ['missed', 'missed', 'entered'])];
    const tree = treeOf(family(rows), forksOf(rows));

    expect(tree.leaves).toBe(2);
    expect(tree.root.branches.map((branch) => [branch.cell, branch.stories.map((s) => s.member), branch.main, branch.y])).toEqual([
      ['entered', ['sale'], false, 0],
      ['missed', ['control', 'control-dark'], true, 1],
    ]);
    // The trunk sits on its own continuation's row, not on the arm's.
    expect(tree.root.y).toBe(1);
  });

  it('splits a bundle again only at a later fork that divides it', () => {
    const rows = [
      row('price', 10, ['missed', 'missed', 'entered']),
      row('badge', 12, ['missed', 'entered', 'missed']),
    ];
    const tree = treeOf(family(rows), forksOf(rows));

    const [sale, trunk] = tree.root.branches;
    expect(sale).toMatchObject({ from: 0, at: 2, branches: [] });
    expect(trunk).toMatchObject({ from: 0, at: 1 });
    expect(trunk?.branches.map((branch) => [branch.cell, branch.stories.map((s) => s.member)])).toEqual([
      ['entered', ['control-dark']],
      ['missed', ['control']],
    ]);
    expect(tree.leaves).toBe(3);
  });
});
