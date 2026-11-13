/**
 * The bit rows the case fold keeps its test-by-region relation in: one row of
 * `words` 32-bit words per region, a bit per test.
 */

export function markRange(
  bits: Uint32Array,
  at: number,
  words: number,
  first: number,
  last: number,
): void {
  if (first >= last) return;
  const firstWord = first >>> 5;
  const lastWord = (last - 1) >>> 5;
  if (firstWord === lastWord) {
    const end = last & 31;
    const high = end === 0 ? 0xffff_ffff : (2 ** end - 1) >>> 0;
    bits[at + firstWord] = bits[at + firstWord]! | (high & (0xffff_ffff << (first & 31)));
    return;
  }
  bits[at + firstWord] = bits[at + firstWord]! | (0xffff_ffff << (first & 31));
  bits.fill(0xffff_ffff, at + firstWord + 1, at + lastWord);
  const end = last & 31;
  bits[at + lastWord] = bits[at + lastWord]! | (end === 0 ? 0xffff_ffff : (2 ** end - 1) >>> 0);
  // `words` is part of the address contract; keep an impossible range from
  // silently writing into the next block if a corrupt coordinate reaches here.
  if (lastWord >= words) throw new Error('case journal names a test outside the run');
}

/** Collect one block's set bits as test ordinals. */
export function collect(bits: Uint32Array, at: number, words: number, out: Uint32Array): number {
  let held = 0;
  for (let word = 0; word < words; word += 1) {
    let value = bits[at + word]!;
    while (value !== 0) {
      const low = 31 - Math.clz32(value & -value);
      out[held++] = (word << 5) + low;
      value &= value - 1;
    }
  }
  return held;
}

export function moduleOf(
  offsets: Uint32Array,
  first: number,
  last: number,
  block: number,
): number {
  let low = first;
  let high = last;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle]! <= block) low = middle;
    else high = middle;
  }
  return low;
}
