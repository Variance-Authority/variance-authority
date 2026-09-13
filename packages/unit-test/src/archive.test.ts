import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaptureArtifact } from '@variance-authority/core';
import {
  CAPTURE_SUFFIX,
  captureFileName,
  captureFiles,
  resetCaptures,
  writeCapture,
} from './archive.js';

/**
 * The handoff directory, read as a directory rather than as a private channel.
 *
 * The unit runner writes here and the CLI reads here, minutes or a CI stage
 * apart, and nothing coordinates the two beyond the suffix. So this asks the
 * three questions a shared directory raises and the round-trip in
 * [`capture.test.ts`](./capture.test.ts) cannot: what else is allowed to be in
 * it, what order it comes back in, and what happens when it is not there.
 */

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directoryWith(names: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'variance-archive-'));
  temporary.push(directory);
  for (const name of names) await writeFile(join(directory, name), '{}\n', 'utf8');
  return directory;
}

describe('captureFiles', () => {
  it('takes the suffix and leaves everything else alone', async () => {
    const directory = await directoryWith([
      `zebra${CAPTURE_SUFFIX}`,
      `alpha${CAPTURE_SUFFIX}`,
      'coverage.json',
      'notes.md',
    ]);

    // The runner's output directory is somebody else's directory too. Claiming
    // every file in it would hand the collector a coverage report to parse as a
    // capture, and the failure would read as a corrupt capture.
    expect((await captureFiles(directory)).map((path) => path.slice(directory.length + 1))).toEqual([
      `alpha${CAPTURE_SUFFIX}`,
      `zebra${CAPTURE_SUFFIX}`,
    ]);
  });

  it('returns them sorted, so a plan does not depend on the filesystem', async () => {
    const directory = await directoryWith(
      ['b', 'c', 'a'].map((name) => `${name}${CAPTURE_SUFFIX}`),
    );

    // `readdir` order is the filesystem's, and it differs between a developer's
    // machine and CI. Subject order decides report order, and a report that
    // reshuffles between runs is a diff nobody can read.
    const listed = await captureFiles(directory);
    expect(listed).toEqual([...listed].sort());
  });

  it('refuses a directory that is not there instead of reporting no captures', async () => {
    // The one failure worth a throw. An empty list is a legitimate answer — a
    // suite that captured nothing — so a missing directory answering the same way
    // is a run that compares nothing, passes, and says so in green.
    await expect(captureFiles(join(tmpdir(), 'variance-archive-absent'))).rejects.toThrow(
      'cannot read capture directory',
    );
  });
});

describe('resetCaptures', () => {
  /**
   * Minimal enough to be written and read back by name.
   *
   * `writeCapture` addresses the file by the subject id and serialises the rest,
   * so the id is the only field these tests are about. The shape is checked on
   * the way *in* by `readCapture`, which is a different question.
   */
  const artifact = (id: string): CaptureArtifact =>
    ({ artifactVersion: 1, subject: { id, kind: 'fixture' } }) as unknown as CaptureArtifact;

  it('lets the same subject be captured again on the next run', async () => {
    // The whole reason it exists. Without this call the second run of an
    // unchanged suite fails, and it fails with a message about two subjects
    // sharing an id — to somebody who has only ever had one.
    const directory = await directoryWith([]);
    await writeCapture(directory, artifact('badge/urgent'));
    await expect(writeCapture(directory, artifact('badge/urgent'))).rejects.toThrow(
      'already has a capture',
    );

    await resetCaptures(directory);
    await expect(writeCapture(directory, artifact('badge/urgent'))).resolves.toContain(
      'badge%2Furgent',
    );
  });

  it('takes the captures and leaves everything else', async () => {
    // Same reasoning as `captureFiles`' filter, with more at stake: that one
    // misreads a neighbouring file, this one would delete it.
    const directory = await directoryWith([`alpha${CAPTURE_SUFFIX}`, 'coverage.json']);

    await resetCaptures(directory);

    expect(await captureFiles(directory)).toEqual([]);
    await expect(readFile(join(directory, 'coverage.json'), 'utf8')).resolves.toBe('{}\n');
  });

  it('accepts a directory that is not there, because that is the first run', async () => {
    // Ordinary, not exceptional: nothing has written a capture yet. Throwing
    // here would make every clean checkout fail before a single test ran.
    await expect(
      resetCaptures(join(tmpdir(), 'variance-archive-never-written')),
    ).resolves.toBeUndefined();
  });
});

describe('a subject id longer than a filename', () => {
  it('keeps a readable prefix and distinguishes by digest', () => {
    const stem = `mui-material/src/Button/Button.test/${'a'.repeat(400)}`;
    const one = captureFileName(`${stem}/first`);
    const two = captureFileName(`${stem}/second`);

    expect(one.length).toBeLessThan(200);
    expect(one.startsWith('mui-material%2Fsrc%2FButton')).toBe(true);
    expect(one).not.toBe(two);
  });

  it('leaves a short id spelled the way it reads', () => {
    expect(captureFileName('button/save')).toBe(`button%2Fsave${CAPTURE_SUFFIX}`);
  });
});
