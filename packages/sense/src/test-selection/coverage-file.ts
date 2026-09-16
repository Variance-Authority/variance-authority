import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { invalid } from './format-validation.js';
import { openTestCoverage, type TestCoverageView } from './format-view.js';
import type { Bytes } from './columns.js';

/**
 * A snapshot read where it lies, instead of read into memory first.
 *
 * A selection is a sparse read. It asks for the regions of the modules a diff
 * named, the sets those regions carry, and the names of the tests that come
 * back — measured at a repository's scale, between a half and five percent of
 * the file. The other ninety-five percent is resident only because the caller
 * handed the reader a buffer, and a buffer is the one thing a reader cannot
 * decline: at 77 MB the snapshot is the largest single allocation a `select`
 * makes, larger than everything the query itself decompresses.
 *
 * So the columns were taught to read through a door ({@link Bytes}) rather than
 * to index a resident array, and this is the other side of that door: `pread`
 * against an open descriptor, one read per run, each read its own small array.
 * Nothing about a column changes — a run still decompresses when something in
 * it is asked for, and the cache still holds the last few.
 */
export interface CoverageFile {
  /** The snapshot, with every column reading through the descriptor. */
  readonly view: TestCoverageView;
  /**
   * Release the descriptor.
   *
   * After this the view answers nothing — a column that has not been read will
   * throw when it is. Everything a query returns is already decoded by the time
   * it returns, so the close belongs in the `finally` of the call that opened.
   */
  close(): void;
}

/**
 * Open a snapshot on disk, reading only what is asked for.
 *
 * The counterpart to handing {@link openTestCoverage} a buffer, and the one the
 * file-taking entry points use. A caller that already holds the bytes — a run
 * that just encoded them, a merge about to fold them — still passes them
 * straight to `openTestCoverage`, which is unchanged.
 */
export function openCoverageFile(file: string): CoverageFile {
  const fd = openSync(file, 'r');
  try {
    return { view: openTestCoverage(descriptor(fd)), close: () => closeSync(fd) };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/**
 * Open it, ask it, close it — for the caller whose whole business with the
 * snapshot is one query.
 *
 * The close is the reason this exists rather than being spelled out at each of
 * the five call sites: an answer that escaped an open descriptor would leak one
 * per query, and a `finally` written once cannot be the one that was forgotten.
 *
 * A question that is still being answered holds the file open until it is. A
 * plain `finally` would close on the way out of `ask`, which for a reader that
 * awaits anything — `deviationOfTests` reads the working tree between two
 * columns — is while the answer is still reading; the descriptor would be shut
 * under a query that had not finished asking.
 */
export function askCoverageFile<T>(file: string, ask: (view: TestCoverageView) => T): T {
  const held = openCoverageFile(file);
  let answer: T;
  try {
    answer = ask(held.view);
  } catch (error) {
    held.close();
    throw error;
  }
  if (!awaited(answer)) {
    held.close();
    return answer;
  }
  return Promise.resolve(answer).finally(() => held.close()) as T;
}

/** Whether the answer is one the caller will await, and so is not finished yet. */
function awaited(answer: unknown): answer is PromiseLike<unknown> {
  return (
    typeof answer === 'object' &&
    answer !== null &&
    typeof (answer as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * The descriptor as a range of bytes, answering the door a column reads through.
 *
 * Each read is its own array rather than a slice of a shared one, which is what
 * lets the read be positional: two runs of two columns are two reads at two
 * offsets, with nothing between them held. The array is freshly allocated, so
 * its `byteOffset` is zero and a plain section can be cast to `Uint32Array`
 * without the copy an unaligned buffer would force.
 */
function descriptor(fd: number): Bytes {
  const length = fstatSync(fd).size;
  return {
    length,
    read: (from, to) => {
      if (from < 0 || to < from || to > length) throw invalid();
      const bytes = new Uint8Array(to - from);
      let filled = 0;
      while (filled < bytes.length) {
        const got = readSync(fd, bytes, filled, bytes.length - filled, from + filled);
        // A short read before the end of the range means the file is no longer
        // the one the index describes, which is the same thing as a bad index.
        if (got === 0) throw invalid();
        filled += got;
      }
      return bytes;
    },
  };
}
