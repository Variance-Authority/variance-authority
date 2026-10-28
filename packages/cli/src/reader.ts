import { once } from 'node:events';
import type { Writable } from 'node:stream';

/**
 * Standard output as a command writes to it: `out` writes, and `drained`
 * resolves once the reader has taken what was written, `false` when it has
 * gone.
 *
 * A reader that stops early, as `head` does, closes the pipe, and the next
 * write fails with `EPIPE`, either as an `'error'` between two writes or while
 * waiting for `'drain'`. Either way the reader has what it asked for: nothing
 * more is written, and the command ends as it would have. Any other error on
 * the stream is the stream's to raise.
 */
export function readerOf(stream: Writable): { out(text: string): void; drained(): Promise<boolean> } {
  let gone = false;
  const left = (error: unknown): boolean => {
    if ((error as { code?: unknown } | null)?.code !== 'EPIPE') return false;
    gone = true;
    return true;
  };
  stream.on('error', (error) => {
    if (!left(error)) throw error;
  });
  return {
    out: (text) => {
      if (!gone) stream.write(text);
    },
    drained: async () => {
      if (!gone && stream.writableNeedDrain) {
        try {
          await once(stream, 'drain');
        } catch (error) {
          if (!left(error)) throw error;
        }
      }
      return !gone;
    },
  };
}
