import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NotObserved, RunReport } from './format.js';

/**
 * The run report as a file — the one thing here that needs a disk.
 *
 * Its own module and its own entrypoint because the *format* is the contract and
 * the disk is an implementation of it. A run happening on a pinned machine in CI
 * and questions being asked on a laptop is exactly why this artifact exists; a
 * consumer who moves it some other way — an object store, a PR comment, a socket
 * — wants the shapes and not this.
 */

export async function writeRunReport(path: string, report: RunReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

/**
 * Read a run report, refusing anything that is not one.
 *
 * The version check is not ceremony. These tools answer questions an agent then
 * edits code on, and a silently-misparsed report produces confident answers about
 * fields that were never there.
 *
 * `notObserved` gets the same treatment for a sharper reason: it is the field a
 * summary claims a clean run *from*, so a malformed entry that survived parsing
 * would be counted as neither a failure nor an exclusion and would silently stop
 * holding the run open. The cost is that a report from a future writer with a
 * third kind is refused outright rather than partly understood — which is the
 * intended trade, because partly understanding a coverage list is exactly the
 * failure this field exists to prevent.
 */
export async function readRunReport(path: string): Promise<RunReport> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<RunReport>;

  if (parsed.runVersion !== 1) {
    throw new Error(
      `${path} is not a variance-authority run report (runVersion=${String(parsed.runVersion)})`,
    );
  }
  if (!Array.isArray(parsed.observations)) {
    throw new Error(`${path} has no observations array`);
  }
  if (parsed.notObserved !== undefined) checkNotObserved(path, parsed.notObserved);

  return parsed as RunReport;
}

function checkNotObserved(path: string, value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error(`${path} has a \`notObserved\` field that is not an array`);
  }

  (value as readonly unknown[]).forEach((entry, index) => {
    const row = entry as Partial<NotObserved>;

    if (typeof row.subject !== 'string' || typeof row.because !== 'string') {
      throw new Error(`${path}: notObserved[${index}] has no \`subject\` and \`because\``);
    }
    if (row.kind !== 'excluded' && row.kind !== 'failed') {
      // Not defaulted. Guessing `excluded` would turn a coverage hole into a
      // decision somebody made, and guessing `failed` would turn every deliberate
      // exclusion into a permanently red build.
      throw new Error(
        `${path}: notObserved[${index}].kind is ${JSON.stringify(row.kind)}, ` +
          'which is neither "excluded" nor "failed"',
      );
    }
  });
}
