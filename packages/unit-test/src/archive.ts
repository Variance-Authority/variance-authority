import { link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureArtifact } from '@variance-authority/core';
import { fileNameFor } from '@variance-authority/core/format';
import { captureArtifactFrom } from './shape.js';

export const CAPTURE_SUFFIX = '.va-capture.json';

/**
 * The file one subject's capture is written to.
 *
 * The id goes in the name because a person looking in this directory is looking
 * for a subject.
 */
export function captureFileName(id: string): string {
  return `${fileNameFor(id)}${CAPTURE_SUFFIX}`;
}

/**
 * Atomically write one capture, and refuse to be the second write for a subject.
 *
 * The filename is the subject id, so two tests capturing `button/save` address
 * one file. `rename` would have taken the second one — silently, successfully,
 * and with half the suite then invisible to the run that reads this directory.
 * `link` is the same atomic publish with the opposite answer to an occupied
 * name: it fails with `EEXIST` rather than overwriting, so a collision costs one
 * failing test instead of a report that is quietly missing a subject.
 *
 * *What it costs.* A capture directory reused across runs fails on the second
 * run, and the second run is the ordinary one: edit a component, re-run the
 * tests, compare. So the run boundary this guard assumes has to be given to the
 * writer rather than described to them — {@link resetCaptures}, once, from
 * wherever the runner starts a run. Without it the guard is right about the
 * directory and wrong about the cause, and it says so to somebody who changed
 * one colour and has no second subject anywhere.
 */
export async function writeCapture(
  directory: string,
  artifact: CaptureArtifact,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, captureFileName(artifact.subject.id));
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  try {
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(
      `${artifact.subject.id} already has a capture at ${path}. Two subjects with one id ` +
        'is a name collision, and taking the later write makes the earlier subject invisible ' +
        'to the run. Give them distinct ids — or, if this is a second run over the same ' +
        'directory, call `resetCaptures` once when the run starts.',
      { cause: error },
    );
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

/**
 * Empty a capture directory, once, at the start of a run.
 *
 * The other half of {@link writeCapture}'s refusal to overwrite. That guard is
 * only correct over a directory that holds one run, and nothing in a test runner
 * makes a directory hold one run by itself — so this is the boundary, called
 * from wherever the runner has a once-per-run hook (`globalSetup` in Vitest, a
 * global setup project in Playwright). Called from a test file it would race the
 * other test files and delete their captures.
 *
 * It removes capture files and nothing else. The directory is named by the
 * adopter and may be one they keep other things in; a helper that took
 * `rm -rf` to a configured path would eventually take it to the wrong one.
 * A directory that is not there yet is not an error — that is the first run.
 */
export async function resetCaptures(directory: string): Promise<void> {
  let entries: readonly string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(CAPTURE_SUFFIX))
      .map((entry) => rm(join(directory, entry), { force: true })),
  );
}

export async function readCapture(path: string): Promise<CaptureArtifact> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read capture artifact ${path}`, { cause: error });
  }

  return captureArtifactFrom(value, path);
}

export async function captureFiles(directory: string): Promise<readonly string[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    throw new Error(`cannot read capture directory ${directory}`, { cause: error });
  }
  return entries
    .filter((entry) => entry.endsWith(CAPTURE_SUFFIX))
    .sort()
    .map((entry) => join(directory, entry));
}
