import { describe, expect, it } from 'vitest';
import { treeOf } from './journey-tree.js';
import type { JourneyCell, JourneyColumn, JourneyFamily, JourneyRow } from './journeys.js';

/**
 * The tree, held to what a reader takes from the picture: the trunk is the
 * lattice's root and runs level, an arm leaves at the first fork that divides
 * its bundle and not before, and one decision is one fork however many regions
 * the instrument recorded for it. The failure that reads as a working picture
 * is a second numbered mark for the same divergence, with nothing forking at
 * it — which every returning `if` would produce, drawn as it comes.
 */

const CONTROL = { subject: 'story:product-card--control', member: 'control' };
const SALE = { subject: 'story:product-card--sale', member: 'sale', from: 'control' };
const DARK = { subject: 'story:product-card--control-dark', member: 'control-dark', from: 'control' };

function row(name: string, line: number, cells: JourneyRow['cells'], kind = 'branch', endLine = line): JourneyRow {
  return {
    file: 'app/src/components/ProductCard.tsx',
    region: { kind, name, startLine: line, endLine, entered: [], missed: [] },
    cells,
  };
}

function family(rows: readonly JourneyRow[], columns: readonly JourneyColumn[] = [CONTROL, DARK, SALE]): JourneyFamily {
  return { name: 'story:product-card', columns, rows };
}

const members = (branch: { readonly stories: readonly JourneyColumn[] }): readonly string[] =>
  branch.stories.map((story) => story.member);

describe('the tree', () => {
  it('is one level line when the family took one path', () => {
    const tree = treeOf(family([]));

    expect(tree.leaves).toBe(1);
    expect(tree.forks).toEqual([]);
    expect(tree.root).toMatchObject({ from: -1, at: 0, main: true, y: 0, branches: [] });
    expect(tree.root.stories).toEqual([CONTROL, DARK, SALE]);
  });

  it('keeps the trunk level and forks the arm that entered off it', () => {
    const price = row('price', 10, ['missed', 'missed', 'entered']);
    const tree = treeOf(family([price]));

    expect(tree.leaves).toBe(2);
    expect(tree.root.branches.map((branch) => [branch.entered, members(branch), branch.main, branch.y])).toEqual([
      [[price], ['sale'], false, 0],
      [[], ['control', 'control-dark'], true, 1],
    ]);
    // The trunk sits on its own continuation's row, not on the arm's.
    expect(tree.root.y).toBe(1);
  });

  it('splits a bundle again only at a later fork that divides it', () => {
    const tree = treeOf(
      family([row('price', 10, ['missed', 'missed', 'entered']), row('badge', 12, ['missed', 'entered', 'missed'])]),
    );

    const [sale, trunk] = tree.root.branches;
    expect(sale).toMatchObject({ from: 0, at: 2, branches: [] });
    expect(trunk).toMatchObject({ from: 0, at: 1 });
    expect(trunk?.branches.map((branch) => [branch.entered.length, members(branch)])).toEqual([
      [1, ['control-dark']],
      [0, ['control']],
    ]);
    expect(tree.leaves).toBe(3);
  });

  it('draws a region that divides two bundles as one mark on both lines', () => {
    const columns = ['a', 'b', 'c', 'd'].map((member) => ({ subject: `story:x--${member}`, member }));
    const first = row('first', 1, ['entered', 'entered', 'missed', 'missed']);
    const second = row('second', 2, ['entered', 'missed', 'entered', 'missed']);
    const tree = treeOf(family([first, second], columns));

    expect(tree.forks).toEqual([
      { rows: [first], alike: [] },
      { rows: [second], alike: [] },
    ]);
    expect(tree.root.branches.map((branch) => branch.at)).toEqual([1, 1]);
    expect(tree.leaves).toBe(4);
  });
});

/**
 * A component with a loading, an error, an empty and a full state, as the
 * instrument records it: every returning `if` is a branch and the continuation
 * after it, and the cases of a `switch` come one after another.
 */
const FULL = { subject: 'story:panel--full', member: 'full' };
const EMPTY = { subject: 'story:panel--empty', member: 'empty', from: 'full' };
const ERROR = { subject: 'story:panel--error', member: 'error', from: 'full' };
const LOADING = { subject: 'story:panel--loading', member: 'loading', from: 'full' };
const PANEL = [FULL, EMPTY, ERROR, LOADING];

/** Cells in `PANEL` order, from the members that entered. */
const only = (...entered: readonly string[]): readonly JourneyCell[] =>
  PANEL.map((column) => (entered.includes(column.member) ? 'entered' : 'missed'));

describe('one decision is one fork', () => {
  it('folds a returning `if` and the continuation after it into one mark', () => {
    const loading = row('Panel', 2, only('loading'));
    const after = row('Panel', 3, only('full', 'empty', 'error'), 'continuation', 5);
    const tree = treeOf(family([loading, after], PANEL));

    expect(tree.forks).toEqual([{ rows: [loading], alike: [after] }]);
    expect(tree.leaves).toBe(2);
  });

  it('draws a chain of `if`s as a mark per `if`, in the order the code asks', () => {
    const rows = [
      row('Panel', 2, only('loading')),
      row('Panel', 3, only('error')),
      row('Panel', 3, only('full', 'empty', 'error'), 'continuation', 5),
      row('Panel', 4, only('empty')),
      row('Panel', 4, only('full', 'empty'), 'continuation', 5),
      row('Panel', 5, only('full'), 'continuation'),
    ];
    const tree = treeOf(family(rows, PANEL));

    expect(tree.forks.map((fork) => [fork.rows.map((r) => r.region?.startLine), fork.alike.map((r) => r.region?.kind)])).toEqual([
      [[2], ['continuation']],
      [[3], ['continuation']],
      [[4], ['continuation']],
    ]);
    // Each mark is on the trunk, and the trunk is `full`, level at the bottom.
    const [loading, rest] = tree.root.branches;
    expect(members(loading as never)).toEqual(['loading']);
    expect(rest).toMatchObject({ at: 1, main: true });
    expect(rest?.branches.map(members)).toEqual([['error'], ['full', 'empty']]);
    expect(rest?.branches[1]?.branches.map(members)).toEqual([['empty'], ['full']]);
    expect(tree.leaves).toBe(4);
    expect(tree.root.y).toBe(3);
  });

  it('draws a `switch` as one mark with a branch per case', () => {
    const loading = row('Panel', 4, only('loading'), 'case');
    const error = row('Panel', 6, only('error'), 'case');
    const afterSwitch = row('Panel', 8, only('full', 'empty'), 'continuation', 9);
    const empty = row('Panel', 8, only('empty'));
    const afterIf = row('Panel', 9, only('full'), 'continuation');
    const tree = treeOf(family([loading, error, empty, afterSwitch, afterIf], PANEL));

    expect(tree.forks).toEqual([
      { rows: [loading, error], alike: [afterSwitch] },
      { rows: [empty], alike: [afterIf] },
    ]);
    expect(tree.root.branches.map((branch) => [members(branch), branch.entered, branch.at])).toEqual([
      [['error'], [error], 2],
      [['full', 'empty'], [], 1],
      [['loading'], [loading], 2],
    ]);
    expect(tree.leaves).toBe(4);
  });

  it('keeps the forks past the limit in the list and out of the picture', () => {
    const rows = [row('Panel', 2, only('loading')), row('Panel', 3, only('error')), row('Panel', 4, only('empty'))];
    const tree = treeOf(family(rows, PANEL), 1);

    expect(tree.forks).toHaveLength(3);
    expect(tree.leaves).toBe(2);
    expect(tree.root.branches.map((branch) => [members(branch), branch.at, branch.branches.length])).toEqual([
      [['loading'], 1, 0],
      [['full', 'empty', 'error'], 1, 0],
    ]);
  });
});
