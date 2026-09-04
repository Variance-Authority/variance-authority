import { link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createEyesArchive, type EyesArchive, type EyesTestAttention } from './access.js';
import { parseEyesArchive } from './archive.js';

/**
 * The producing half of the archive, for a runner that spreads tests over processes.
 *
 * A run is not one journal. Every runner this package integrates with puts tests
 * in worker processes, so no single object in memory holds what the run saw, and
 * a producer that assumed one would archive whichever worker happened to finish
 * last. Each test therefore publishes its own file and the archive is what
 * gathering them produces once the run is over — the same shape
 * `@variance-authority/unit-test` writes its captures in, for the same reason.
 *
 * Each of those files is itself a one-test archive rather than a private
 * intermediate. The `parseEyesArchive` that guards the consolidated artifact
 * therefore guards every fragment on the way in, so a producer emitting
 * something the reader would refuse is caught by the run that wrote it rather
 * than by an agent reading it hours later.
 *
 * The directory is the caller's, as it is for captures: a runner already knows
 * where its own run writes, and a helper holding a default would be the second
 * opinion about it.
 */

/** Distinguishes a per-test journal from whatever else an adopter keeps here. */
export const EYES_JOURNAL_SUFFIX = '.va-eyes.json';

/**
 * Publish one test's journal, refusing to be the second write for a test id.
 *
 * `link` rather than `rename`, for the reason `writeCapture` gives: the filename
 * is the runner's own test id, and taking the second write for an occupied name
 * makes the first test invisible to the archive while every process involved
 * reports success. A collision is a duplicate id, which `createEyesArchive`
 * refuses as well — this is that refusal reached before the evidence is gone
 * rather than after.
 */
export async function recordEyesTest(
  directory: string,
  test: EyesTestAttention,
): Promise<string> {
  const archive = createEyesArchive([test]);
  await mkdir(directory, { recursive: true });

  const path = join(directory, `${encodeURIComponent(test.id)}${EYES_JOURNAL_SUFFIX}`);
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  try {
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(
      `eyes test ${test.id} already has a journal at ${path}. Two tests under one id makes ` +
        'the earlier one invisible to the archive; take the runner id rather than the title, ' +
        'or, if this is a second run over the same directory, call `resetEyesJournals` once ' +
        'when the run starts.',
      { cause: error },
    );
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

/**
 * Empty a journal directory, once, at the start of a run.
 *
 * The other half of {@link recordEyesTest}'s refusal, which is only correct over
 * a directory holding one run. Nothing in a runner makes that true by itself, so
 * this is the boundary — called from the runner's once-per-run hook
 * (`globalSetup` in Vitest, a setup project in Playwright) and never from a test
 * file, where it would race the other workers and delete their journals.
 *
 * Journal files and nothing else: the directory is named by the adopter and may
 * hold other things, and a helper that took `rm -rf` to a configured path would
 * eventually take it to the wrong one. A directory that is not there yet is the
 * first run.
 */
export async function resetEyesJournals(directory: string): Promise<void> {
  let entries: readonly string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(EYES_JOURNAL_SUFFIX))
      .map((entry) => rm(join(directory, entry), { force: true })),
  );
}

/**
 * Fold every journal a run published into one archive, in filename order.
 *
 * A missing directory throws rather than reporting an empty archive: a run whose
 * tests never recorded and a run whose journals were written somewhere else are
 * different situations, and an empty archive says the first about both.
 */
export async function gatherEyesArchive(directory: string): Promise<EyesArchive> {
  let entries: readonly string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    throw new Error(`cannot read eyes journal directory ${directory}`, { cause: error });
  }

  const tests: EyesTestAttention[] = [];
  for (const entry of entries.filter((name) => name.endsWith(EYES_JOURNAL_SUFFIX)).sort()) {
    const path = join(directory, entry);
    let fragment: EyesArchive;
    try {
      fragment = parseEyesArchive(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      throw new Error(`cannot read eyes journal ${path}`, { cause: error });
    }
    tests.push(...fragment.tests);
  }
  return createEyesArchive(tests);
}

/** Write the gathered archive where a reader in another process will find it. */
export async function writeEyesArchive(path: string, archive: EyesArchive): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
}
