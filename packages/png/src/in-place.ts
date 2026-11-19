import { DEFAULT_POLICY, type RowSpan } from '@variance-authority/raster';
import type { PairedRows } from './align.js';
import { colorDelta } from './judge.js';

/**
 * Rows the shortest edit moved that belong where they are.
 *
 * A band repainted by a level, a header shaded row by row and drawn one shade
 * lighter, makes each after row a copy of the before row under it. The edit
 * pairs the band one row off, and an insertion elsewhere on the page outweighs
 * that, so the band is marked as moved and every row of it as changed. A run
 * whose move the rows above and below it do not share is a detour: paired at
 * their move instead, it is kept there when what it leaves differing under
 * {@link DEFAULT_POLICY}, an unpaired row its width, is less than the detour
 * leaves. The alignment is one for every policy, and the default is the one a
 * verdict is decided under. `costs` is kept true for the rows paired anew.
 */
export function inPlace(
  rows: PairedRows,
  was: Uint32Array,
  now: Uint32Array,
  beforeHeight: number,
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
      if (Math.abs(colorDelta(first, second, x * 4, afterRow * width * 4 + x * 4)) > limit) count += 1;
    }
    return count;
  };

  let { inserted, removed, shifted, grown, shrunk } = rows;
  let changed = false;
  for (const { from, to, by } of rows.shifted) {
    if (!source.subarray(from, to).some((_, row) => moveOf(from + row) === by)) continue;
    // The nearest paired rows above and below that move otherwise.
    let top = from - 1;
    while (top >= 0 && (source[top]! < 0 || moveOf(top) === by)) top -= 1;
    let bottom = to;
    while (bottom < height && (source[bottom]! < 0 || moveOf(bottom) === by)) bottom += 1;
    // A move that runs to an edge of the page is not a detour: nothing returns.
    if (top < 0 || bottom >= height) continue;
    const move = moveOf(top);
    if (moveOf(bottom) !== move) continue;
    const first = top + 1;
    const end = bottom;
    if (first - move < 0 || end - move > beforeHeight) continue;

    const used = new Uint8Array(end - first);
    let detour = 0;
    for (let y = first; y < end; y += 1) {
      const from = source[y]!;
      if (from < 0) {
        detour += width;
        continue;
      }
      detour += forgiven(from, y);
      if (from >= first - move && from < end - move) used[from - first + move] = 1;
    }
    for (const mark of used) if (mark === 0) detour += width;
    let placed = 0;
    for (let y = first; y < end && placed < detour; y += 1) placed += forgiven(y - move, y);
    if (placed >= detour) continue;

    for (let y = first; y < end; y += 1) {
      source[y] = y - move;
      costs[y] = cost(y - move, y);
    }
    const outside = (span: RowSpan, low: number): boolean => span.to <= low || span.from >= low + end - first;
    inserted = inserted.filter((span) => outside(span, first));
    grown = grown.filter((span) => outside(span, first));
    removed = removed.filter((span) => outside(span, first - move));
    shrunk = shrunk.filter((span) => outside(span, first - move));
    shifted = [...shifted.filter((span) => outside(span, first)), ...(move === 0 ? [] : [{ from: first, to: end, by: move }])];
    changed = true;
  }
  if (!changed) return rows;

  // Spans that now touch at the same move are one.
  const merged: { from: number; to: number; by: number }[] = [];
  for (const span of [...shifted].sort((left, right) => left.from - right.from)) {
    const last = merged.at(-1);
    if (last !== undefined && last.to === span.from && last.by === span.by) last.to = span.to;
    else merged.push({ ...span });
  }
  return { source, inserted, removed, shifted: merged, grown, shrunk };
}
