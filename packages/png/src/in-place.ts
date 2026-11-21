import type { PairedRows } from './align.js';
import { colorDelta, limitOf } from './judge.js';
import { regrouped } from './straddle.js';

/**
 * Rows the shortest edit moved that belong where they are: a band repainted by
 * a level, which the edit pairs one row off beside a real insertion, is paired
 * at the move of the rows around it when that leaves less differing under
 * `threshold`, the policy's whose verdict it serves. `costs` is kept true for the rows paired anew.
 */
export function inPlace(
  rows: PairedRows,
  was: Uint32Array,
  now: Uint32Array,
  width: number,
  threshold: number,
  cost: (beforeRow: number, afterRow: number) => number,
  costs: Int32Array,
): PairedRows {
  const { source } = rows;
  const height = source.length;
  const moveOf = (y: number): number => y - source[y]!;
  const before = new Uint8Array(was.buffer, was.byteOffset, was.byteLength);
  const after = new Uint8Array(now.buffer, now.byteOffset, now.byteLength);
  const limit = limitOf(threshold);
  const forgiven = (beforeRow: number, afterRow: number): number => {
    const first = before.subarray(beforeRow * width * 4, (beforeRow + 1) * width * 4);
    const second = after.subarray(afterRow * width * 4, (afterRow + 1) * width * 4);
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      if (was[beforeRow * width + x] === now[afterRow * width + x]) continue;
      if (Math.abs(colorDelta(first, second, x * 4, (afterRow * width + x) * 4)) > limit) count += 1;
    }
    return count;
  };

  // The paired rows in runs of one move; an unpaired row breaks none.
  const runs: Run[] = [];
  for (let y = 0; y < height; y += 1) {
    if (source[y]! < 0) continue;
    const run = runs.at(-1);
    if (run !== undefined && run.by === moveOf(y)) run.last = y;
    else runs.push({ first: y, last: y, by: moveOf(y) });
  }
  // Which reported shift each after row is in, so a shift stays one as placing changes its rows.
  const span = new Int32Array(height).fill(-1);
  rows.shifted.forEach((shift, index) => span.fill(index, shift.from, shift.to));

  // The pairing as it was, kept from the first placement in case all of them come to nothing moved.
  let saved: { source: Int32Array; costs: Int32Array } | undefined;
  // The unpaired after rows, counted over any span in logarithmic steps as placing pairs them.
  const unpaired = new Int32Array(height + 1);
  const unpair = (row: number, by: number): void => {
    for (let index = row + 1; index <= height; index += index & -index) unpaired[index]! += by;
  };
  const unpairedBefore = (row: number): number => {
    let count = 0;
    for (let index = row; index > 0; index -= index & -index) count += unpaired[index]!;
    return count;
  };
  for (let y = 0; y < height; y += 1) if (source[y]! < 0) unpair(y, 1);
  // What a run leaves differing as it is paired, an unpaired row in it counting its
  // width: read once, and a fold adds up its parts, so no row is read again.
  const weightOf = (run: Run): number => {
    if (run.weight !== undefined) return run.weight;
    let weight = 0;
    for (let row = run.first; row <= run.last; row += 1) weight += source[row]! < 0 ? width : forgiven(source[row]!, row);
    return (run.weight = weight);
  };
  const reclaimed = new Uint8Array(was.length / width);
  // What `run` leaves differing paired at the move of the two around it, when that
  // is less than the detour leaves: the run, the unpaired rows beside it and each
  // before row it leaves unused counting their width. Rows between runs are unpaired.
  const placeable = (above: Run, run: Run, below: Run): number | undefined => {
    const first = above.last + 1;
    const bottom = below.first;
    const move = above.by;

    // The run's paired rows whose before row the move around it would use.
    const from = Math.max(run.first, first - move + run.by);
    const to = Math.min(run.last + 1, bottom - move + run.by);
    const used = from < to ? to - from - (unpairedBefore(to) - unpairedBefore(from)) : 0;
    const beside = run.first - first + (bottom - run.last - 1);
    const detour = weightOf(run) + (beside + bottom - first - used) * width;
    let kept = 0;
    for (let row = first; row < bottom && kept < detour; row += 1) kept += forgiven(row - move, row);
    if (kept >= detour) return undefined;

    saved ??= { source: source.slice(), costs: costs.slice() };
    for (let row = first; row < bottom; row += 1) {
      if (source[row]! < 0) unpair(row, -1);
      source[row] = row - move;
      costs[row] = cost(row - move, row);
    }
    reclaimed.fill(1, first - move, bottom - move);
    return kept;
  };
  // Runs read so far, a detour placed folding into the run above it, so the one
  // around it is weighed when the run below it arrives. The three under a fold
  // were weighed when its top arrived: they span the same rows and lost.
  const stack: Run[] = [];
  let changed = false;
  for (const next of runs) {
    stack.push(next);
    if (stack.length < 3) continue;
    const [above, run, below] = stack.slice(-3) as [Run, Run, Run];
    if (above.by !== below.by) continue;
    const kept = placeable(above, run, below);
    if (kept === undefined) continue;
    const weight = weightOf(above) + kept + weightOf(below);
    stack.splice(-3, 3, { first: above.first, last: below.last, by: above.by, weight });
    changed = true;
  }
  if (!changed) return rows;

  // A shift reported before placing stays one, its rows read at the move most of them make now.
  const joined = new Uint8Array(height);
  for (let y = 1; y < height; y += 1) if (span[y]! >= 0 && span[y] === span[y - 1]) joined[y] = 1;
  const regrouping = regrouped({ ...rows, source }, joined, (row) => reclaimed[row] === 1);
  // Rows all back in place leave nothing for a pairing to explain: position reads them.
  const { shifted, inserted, removed } = regrouping;
  if (shifted.length === 0 && inserted.length === 0 && removed.length === 0) {
    source.set(saved!.source);
    costs.set(saved!.costs);
    return rows;
  }
  return regrouping;
}

interface Run {
  readonly first: number;
  last: number;
  readonly by: number;
  weight?: number;
}
