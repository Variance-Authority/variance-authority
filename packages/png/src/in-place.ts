import { DEFAULT_POLICY, type RowSpan } from '@variance-authority/raster';
import type { PairedRows } from './align.js';
import { colorDelta } from './judge.js';

/**
 * Rows the shortest edit moved that belong where they are.
 *
 * A band repainted by a level, a header shaded row by row and drawn one shade
 * lighter, makes each after row a copy of the before row under it. The edit
 * pairs the band one row off, and an insertion elsewhere on the page outweighs
 * that, so the band is marked as moved and every row of it as changed. A run of
 * one move whose neighbours above and below share another is a detour: paired at
 * their move instead, it is kept there when what it leaves differing under
 * {@link DEFAULT_POLICY}, an unpaired row its width, is less than the detour
 * leaves. The alignment is one for every policy, and the default is the one a
 * verdict is decided under. `costs` is kept true for the rows paired anew.
 */
export function inPlace(
  rows: PairedRows,
  was: Uint32Array,
  now: Uint32Array,
  width: number,
  cost: (beforeRow: number, afterRow: number) => number,
  costs: Int32Array,
): PairedRows {
  const { source } = rows;
  const height = source.length;
  const moveOf = (y: number): number => y - source[y]!;
  const before = new Uint8Array(was.buffer, was.byteOffset, was.byteLength);
  const after = new Uint8Array(now.buffer, now.byteOffset, now.byteLength);
  const limit = 35215 * DEFAULT_POLICY.threshold * DEFAULT_POLICY.threshold;
  const forgiven = (beforeRow: number, afterRow: number): number => {
    const first = before.subarray(beforeRow * width * 4, (beforeRow + 1) * width * 4);
    const second = after.subarray(afterRow * width * 4, (afterRow + 1) * width * 4);
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      if (was[beforeRow * width + x] === now[afterRow * width + x]) continue;
      if (Math.abs(colorDelta(first, second, x * 4, afterRow * width + x)) > limit) count += 1;
    }
    return count;
  };

  let { inserted, removed, grown, shrunk } = rows;
  let changed = false;
  for (let y = 0; y < height; ) {
    if (source[y]! < 0) {
      y += 1;
      continue;
    }
    // The run of one move, and the nearest paired rows above and below it that move otherwise.
    const by = moveOf(y);
    let top = y - 1;
    while (top >= 0 && (source[top]! < 0 || moveOf(top) === by)) top -= 1;
    let bottom = y + 1;
    while (bottom < height && (source[bottom]! < 0 || moveOf(bottom) === by)) bottom += 1;
    y = bottom;
    // A move that runs to an edge of the page is not a detour: nothing returns.
    if (top < 0 || bottom >= height || moveOf(top) !== moveOf(bottom)) continue;
    const move = moveOf(top);
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
    let placed = 0;
    for (let row = first; row < bottom && placed < detour; row += 1) placed += forgiven(row - move, row);
    if (placed >= detour) continue;

    for (let row = first; row < bottom; row += 1) {
      source[row] = row - move;
      costs[row] = cost(row - move, row);
    }
    const outside = (span: RowSpan, low: number): boolean => span.to <= low || span.from >= low + bottom - first;
    inserted = inserted.filter((span) => outside(span, first));
    grown = grown.filter((span) => outside(span, first));
    removed = removed.filter((span) => outside(span, first - move));
    shrunk = shrunk.filter((span) => outside(span, first - move));
    changed = true;
  }
  if (!changed) return rows;

  const shifted: { from: number; to: number; by: number }[] = [];
  for (let y = 0; y < height; y += 1) {
    if (source[y]! < 0 || moveOf(y) === 0) continue;
    const last = shifted.at(-1);
    if (last !== undefined && last.to === y && last.by === moveOf(y)) last.to = y + 1;
    else shifted.push({ from: y, to: y + 1, by: moveOf(y) });
  }
  return { source, inserted, removed, shifted, grown, shrunk };
}
