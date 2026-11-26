// compass: variance-authority.reach.crossings
/**
 * The few `Buffer` calls the record reader makes, over a `Uint8Array`, for the
 * page `variance view` writes. Imported before the reader, and never by Node.
 */

class PageBuffer extends Uint8Array {
  static override from(held: string | ArrayLike<number> | ArrayBufferLike | Iterable<number>, at?: unknown, length?: unknown): PageBuffer {
    if (typeof held === 'string') return new PageBuffer(new TextEncoder().encode(held));
    if (held instanceof ArrayBuffer) return new PageBuffer(held, at as number | undefined, length as number | undefined);
    return new PageBuffer(held as ArrayLike<number>);
  }

  static alloc(length: number): PageBuffer {
    return new PageBuffer(length);
  }

  static allocUnsafe(length: number): PageBuffer {
    return new PageBuffer(length);
  }

  static concat(parts: readonly Uint8Array[]): PageBuffer {
    const whole = new PageBuffer(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      whole.set(part, at);
      at += part.length;
    }
    return whole;
  }

  copy(target: Uint8Array, to = 0, from = 0, end = this.length): number {
    target.set(this.subarray(from, end), to);
    return end - from;
  }

  readUInt32LE(at = 0): number {
    return new DataView(this.buffer, this.byteOffset).getUint32(at, true);
  }

  override toString(encoding?: string, from?: number, end?: number): string {
    const part = new Uint8Array(this.buffer, this.byteOffset, this.byteLength).subarray(from ?? 0, end);
    if (encoding === 'hex') return Array.from(part, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return new TextDecoder().decode(part);
  }
}

(globalThis as { Buffer?: unknown }).Buffer ??= PageBuffer;
