import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { writePieces } from './json-pieces.js';
import { readerOf } from './reader.js';

const epipe = () => Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

/** A pipe whose reader takes `taken` writes, then closes it, as `head` does. */
function pipeTo(taken: number, highWaterMark: number) {
  const written: string[] = [];
  const stream = new Writable({
    highWaterMark,
    write(chunk: Buffer, _, done) {
      if (written.length === taken) return done(epipe());
      written.push(chunk.toString());
      // The reader takes its writes later, so a full buffer waits for `'drain'`.
      setImmediate(done);
    },
  });
  return { stream, written };
}

const pieces = (count: number) => Array.from({ length: count }, () => 'x'.repeat(1 << 16));

describe('writing to a reader that stops early', () => {
  it('ends quietly when the pipe closes while a batch waits for the reader', async () => {
    const { stream, written } = pipeTo(1, 1);
    await expect(writePieces(pieces(4), readerOf(stream))).resolves.toBeUndefined();
    expect(written).toHaveLength(1);
  });

  it('ends quietly when the pipe closes between two batches', async () => {
    // A buffer that never fills: no batch waits for `'drain'`, and the failed write is an `'error'` between batches.
    const { stream, written } = pipeTo(1, 1 << 30);
    const reader = readerOf(stream);
    let made = 0;
    const counted = function* () {
      for (const piece of pieces(64)) {
        made += 1;
        yield piece;
      }
    };
    await writePieces(counted(), {
      out: reader.out,
      drained: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return reader.drained();
      },
    });
    expect(written).toHaveLength(1);
    // Nothing more is made once the reader has gone.
    expect(made).toBeLessThan(64);
  });

  it('raises an error that is not the reader leaving, between two writes', () => {
    const stream = new Writable({ write: (_chunk, _, done) => done() });
    readerOf(stream);
    expect(() => stream.emit('error', Object.assign(new Error('write EIO'), { code: 'EIO' }))).toThrow('write EIO');
  });

  it('raises an error that is not the reader leaving, while waiting for the reader', async () => {
    const stream = new Writable({ highWaterMark: 1, write: () => undefined });
    const reader = readerOf(stream);
    stream.removeAllListeners('error');
    reader.out('xx');
    const waiting = reader.drained();
    stream.destroy(Object.assign(new Error('write EIO'), { code: 'EIO' }));
    await expect(waiting).rejects.toThrow('write EIO');
  });
});
