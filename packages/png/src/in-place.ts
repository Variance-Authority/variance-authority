import type { RowSpan } from '@variance-authority/raster';
import type { PairedRows } from './align.js';
import { colorDelta, limitOf } from './judge.js';

/**
 * Rows the shortest edit moved that belong where they are.
 *
 * A band repainted by a level, a header shaded row by row and drawn one shade
 * lighter, makes each after row a copy of the before row under it. The edit
 * pairs the band one row off, and an insertion elsewhere on the page outweighs
 * that, so the band is marked as moved and every row of it as changed. A run of
 * one move whose neighbours above and below share another is a detour: paired at
 * their move instead, it is kept there when what it leaves differing under
 * `threshold`, an unpaired row its width, is less than the detour leaves, where
 * a before row the detour leaves unused counts its width too. `threshold` is the
 * most lenient policy's that will judge the pairing. A detour placed joins the
 * runs around it, so the detour it sat inside is weighed next. `costs` is kept
 * true for the rows paired anew.
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
  // Which reported shift each after row is in, so a shift no detour touched stays as it was.
  const span = new Int32Array(height).fill(-1);
  rows.shifted.forEach((shift, index) => span.fill(index, shift.from, shift.to));

  const placed = new Uint8Array(height);
  const reclaimed = new Uint8Array(was.length / width);
  // Pairs `run` at the move of the two around it, where that leaves less differing.
  const placeable = (above: Run, run: Run, below: Run): boolean => {
    const top = above.last;
    const bottom = below.first;
    const move = above.by;
    const first = top + 1;

    const used = new Uint8Array(bottom - first);
    let detour = 0;
    for (let row = first; row < bottom; row += 1) {
      const from = source[row]!;
      if (from < 0) {
        detour += width;
        continue;
      }
      detour += forgiven(from, row);
      if (from >= first - move && from < bottom - move) used[from - first + move] = 1;
    }
    for (const mark of used) if (mark === 0) detour += width;
    let kept = 0;
    for (let row = first; row < bottom && kept < detour; row += 1) kept += forgiven(row - move, row);
    if (kept >= detour) return false;

    for (let row = first; row < bottom; row += 1) {
      source[row] = row - move;
      costs[row] = cost(row - move, row);
    }
    placed.fill(1, first, bottom);
    reclaimed.fill(1, first - move, bottom - move);
    return true;
  };
  // Runs read so far, a detour placed folding into the run above it, so the one
  // around it is weighed next.
  const stack: Run[] = [];
  let changed = false;
  for (const next of runs) {
    stack.push(next);
    while (stack.length >= 3) {
      const [above, run, below] = stack.slice(-3) as [Run, Run, Run];
      if (above.by !== below.by || !placeable(above, run, below)) break;
      stack.splice(-3, 3, { first: above.first, last: below.last, by: above.by });
      changed = true;
    }
  }
  if (!changed) return rows;

  // A span of unpaired rows lies wholly inside a placed band or wholly outside it.
  const unplaced = (span: RowSpan): boolean => placed[span.from] === 0;
  const unreclaimed = (span: RowSpan): boolean => reclaimed[span.from] === 0;
  // A shift holding a placed row is read again row by row; any other stays as it was.
  const touched = new Uint8Array(rows.shifted.length);
  for (let y = 0; y < height; y += 1) if (placed[y] && span[y]! >= 0) touched[span[y]!] = 1;
  const own = (y: number): boolean => placed[y] === 1 || (span[y]! >= 0 && touched[span[y]!] === 1);
  const shifted: { from: number; to: number; by: number }[] = [];
  for (let y = 0; y < height; y += 1) {
    if (source[y]! < 0) continue;
    const by = own(y) ? moveOf(y) : span[y]! >= 0 ? rows.shifted[span[y]!]!.by : 0;
    if (by === 0) continue;
    const open = shifted.at(-1);
    if (open?.to === y && open.by === by && (own(y) || own(y - 1) || span[y] === span[y - 1])) open.to = y + 1;
    else shifted.push({ from: y, to: y + 1, by });
  }
  return {
    source,
    inserted: rows.inserted.filter(unplaced),
    removed: rows.removed.filter(unreclaimed),
    shifted,
    grown: rows.grown.filter(unplaced),
    shrunk: rows.shrunk.filter(unreclaimed),
  };
}

interface Run {
  readonly first: number;
  last: number;
  readonly by: number;
}
