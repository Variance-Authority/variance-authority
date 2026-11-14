/**
 * Unsigned varints of at most five bytes, as the case lines (`case-lines.ts`)
 * and the readings section (`readings-bytes.ts`) write every number.
 */

/** Appends `value`, seven bits to a byte, low bits first; a value five bytes cannot hold is refused. */
export function put(out: number[], value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= 2 ** 35) throw new RangeError(`${value} is not a varint of at most five bytes`);
  let rest = value;
  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
}

/** A reader over `bytes` that throws what `invalid` returns on a varint or a slice they do not hold. */
export function varints(bytes: Uint8Array, invalid: () => Error): { take(): number; bytes(length: number): Uint8Array; readonly left: number; readonly done: boolean } {
  let at = 0;
  return {
    take(): number {
      let value = 0;
      for (let shift = 0; ; shift += 7) {
        const byte = bytes[at++];
        if (byte === undefined || shift > 28) throw invalid();
        value += (byte & 0x7f) * 2 ** shift;
        if (byte < 0x80) return value;
      }
    },
    bytes(length: number): Uint8Array {
      if (at + length > bytes.length) throw invalid();
      at += length;
      return bytes.subarray(at - length, at);
    },
    get left(): number {
      return bytes.length - at;
    },
    get done(): boolean {
      return at === bytes.length;
    },
  };
}
