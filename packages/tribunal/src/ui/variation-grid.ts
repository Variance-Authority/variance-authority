/**
 * Where a subject's variations sit, when they vary on two axes at once.
 *
 * A pair answers *what does this flag do*. Each link compares a subject with
 * one neighbour — `card--sale-dark` with `card--sale` — and its neighbour on the
 * other axis, `card--dark`, with nothing, so *what do these two flags do
 * together* has no pair. Laid out with one axis down and the other across, every
 * subject sits beside both neighbours — and a combination the run never rendered
 * is an empty cell, which a list of pairs has no place to show.
 *
 * Placement reads the `step` a name format wrote on each record and nothing
 * else. A subject reached through a link without one has no coordinate, and its
 * family is drawn as pairs: a guessed cell is a comparison somebody reads as
 * measured.
 */

import { codeUnitOrder as compare } from '@variance-authority/core/segment';
import type { VariationRecord, VariationStep } from '@variance-authority/report';

/** One axis of a grid: what it is called and its values, the base first. */
export interface GridAxis {
  readonly axis: string;
  readonly values: readonly string[];
}

/** A root and every subject varying from it, at its coordinate. */
export interface VariationGrid {
  readonly root: string;
  /** The axis the name format writes first, so the grid reads the way a name does. */
  readonly rows: GridAxis;
  /** The other axis. */
  readonly columns: GridAxis;
  /** By row, then column. `undefined` is a combination this run has no subject at. */
  readonly cells: readonly (readonly (string | undefined)[])[];
}

interface Placed {
  readonly subject: string;
  /** Root to leaf, one entry per axis, the nearest step's value winning. */
  readonly coordinate: readonly { readonly axis: string; readonly value: string }[];
}

interface Family {
  readonly placed: Placed[];
  /** Each axis's base value, and where the name format writes the axis. */
  readonly base: Map<string, { readonly value: string; readonly position: number }>;
  unplaceable: boolean;
}

/**
 * Every family that varies on exactly two axes, by root.
 *
 * One axis is a pair, already drawn. Three or more have no flat layout that
 * keeps every neighbour next to its neighbour, so they stay pairs too rather
 * than be drawn as a grid that hides an axis.
 */
export function gridsOf(variations: readonly VariationRecord[]): VariationGrid[] {
  const links = new Map(variations.filter((each) => each.parent !== undefined).map((each) => [each.subject, each]));
  const families = new Map<string, Family>();

  for (const variation of [...links.values()].sort(bySubject)) {
    const steps: VariationStep[] = [];
    let unplaceable = false;
    let at: VariationRecord | undefined = variation;
    let root = variation.subject;
    const seen = new Set<string>();
    while (at !== undefined && at.parent !== undefined && !seen.has(at.subject)) {
      seen.add(at.subject);
      if (at.step === undefined) unplaceable = true;
      else steps.push(at.step);
      root = at.parent;
      at = links.get(at.parent);
    }
    // A cycle has no root, and a family with no root has no corner to start from.
    if (at !== undefined && seen.has(at.subject)) continue;

    const family: Family = families.get(root) ?? { placed: [], base: new Map(), unplaceable: false };
    families.set(root, family);
    if (unplaceable) {
      family.unplaceable = true;
      continue;
    }

    // Walked leaf to root; read root to leaf, so a nearer step overwrites a farther one.
    const coordinate = new Map<string, string>();
    for (let index = steps.length - 1; index >= 0; index--) {
      const step = steps[index]!;
      // The step leaves a parent that has no value on this axis, so it leaves
      // the base — the format's first value, the same for every such step.
      if (!coordinate.has(step.axis) && !family.base.has(step.axis)) {
        family.base.set(step.axis, { value: step.from, position: step.position });
      }
      coordinate.set(step.axis, step.to);
    }
    family.placed.push({
      subject: variation.subject,
      coordinate: [...coordinate].map(([axis, value]) => ({ axis, value })),
    });
  }

  const grids: VariationGrid[] = [];
  for (const [root, family] of [...families].sort(([left], [right]) => compare(left, right))) {
    if (family.unplaceable) continue;
    const grid = layOut(root, family);
    if (grid !== undefined) grids.push(grid);
  }
  return grids;
}

function layOut(root: string, family: Family): VariationGrid | undefined {
  const axes = [...family.base].sort(([, left], [, right]) => left.position - right.position).map(([axis]) => axis);
  if (axes.length !== 2) return undefined;

  const [rows, columns] = axes.map((axis) => axisOf(axis, family)) as [GridAxis, GridAxis];
  const cells = rows.values.map(() => columns.values.map((): string | undefined => undefined));
  const place = (subject: string, row: string, column: string): boolean => {
    const line = cells[rows.values.indexOf(row)]!;
    const index = columns.values.indexOf(column);
    // Two subjects at one coordinate is a run where a name means two subjects;
    // picking either would put a difference on the wrong render.
    if (line[index] !== undefined) return false;
    line[index] = subject;
    return true;
  };

  // The root is the base on both axes: the corner, and nothing else is there yet.
  cells[0]![0] = root;
  for (const { subject, coordinate } of family.placed) {
    const value = (axis: GridAxis): string =>
      coordinate.find((entry) => entry.axis === axis.axis)?.value ?? axis.values[0]!;
    if (!place(subject, value(rows), value(columns))) return undefined;
  }

  return { root, rows, columns, cells };
}

/** An axis's values, the base first and the rest in subject order. */
function axisOf(axis: string, family: Family): GridAxis {
  const values = [family.base.get(axis)!.value];
  for (const { coordinate } of family.placed) {
    const value = coordinate.find((entry) => entry.axis === axis)?.value;
    if (value !== undefined && !values.includes(value)) values.push(value);
  }
  return { axis, values };
}

function bySubject(left: VariationRecord, right: VariationRecord): number {
  return compare(left.subject, right.subject);
}
