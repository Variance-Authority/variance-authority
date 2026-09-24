/**
 * The process that folds what each Playwright worker's `eyes` fixture published.
 *
 * Every test's journal is written by the worker that ran it, so no process in
 * the run holds all of them until the run is over. This reporter names a fresh
 * directory before the first worker is forked, and folds it into one archive
 * once the last one is done:
 *
 * ```ts
 * export default defineConfig({
 *   reporter: [['list'], ['@variance-authority/eyes/reporter', { archive: '.variance/eyes.json' }]],
 * });
 * ```
 *
 * The directory is this reporter's own, named per run and removed after the
 * fold, so no run reads journals another run published.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FullConfig, Reporter } from '@playwright/test/reporter';
import { gatherEyesArchive, writeEyesArchive } from './collect.js';
import { EYES_ROOT_VARIABLE, EYES_STAGE_VARIABLE } from './stage.js';

export interface EyesReporterOptions {
  /** Where the folded archive goes, relative to the config's `rootDir` or absolute. */
  readonly archive: string;
}

/**
 * Unnamed because a Playwright reporter is loaded by path and read off the
 * default export.
 */
export default class implements Reporter {
  readonly #archive: string;
  #archivePath: string | undefined;
  #directory: string | undefined;

  constructor(options: EyesReporterOptions) {
    if (typeof options?.archive !== 'string' || options.archive === '') {
      throw new Error(
        "@variance-authority/eyes/reporter needs an `archive` path: ['@variance-authority/eyes/reporter', { archive: '.variance/eyes.json' }]",
      );
    }
    this.#archive = options.archive;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig): void {
    // Before the first worker is forked, which is the only moment a worker can
    // still be told where to write.
    this.#archivePath = resolve(config.rootDir, this.#archive);
    this.#directory = resolve(
      dirname(this.#archivePath),
      `.eyes-${process.pid}-${randomUUID()}`,
    );
    process.env[EYES_STAGE_VARIABLE] = this.#directory;
    process.env[EYES_ROOT_VARIABLE] = checkoutOf(config.rootDir);
  }

  async onEnd(): Promise<void> {
    const directory = this.#directory;
    const archive = this.#archivePath;
    if (directory === undefined || archive === undefined) return;
    try {
      if (!existsSync(directory)) {
        // The previous run's archive would otherwise be read as this one's.
        await rm(archive, { force: true });
        // No worker published a journal: no test reached a page composed with
        // `eyesFixtures`. That is not an empty chronology, so no archive says it is.
        process.stderr.write(
          `variance-authority: wrote no eyes archive — no test published a journal; ` +
            'compose `eyesFixtures` into the `test` your specs import\n',
        );
        return;
      }
      await writeEyesArchive(archive, await gatherEyesArchive(directory));
    } finally {
      delete process.env[EYES_STAGE_VARIABLE];
      delete process.env[EYES_ROOT_VARIABLE];
      await rm(directory, { recursive: true, force: true });
    }
  }
}

/**
 * The checkout `from` sits in, as git names it, or `from` itself outside one.
 *
 * `--show-cdup` rather than `--show-toplevel`, which resolves symlinks: a test
 * file under `/var` is not under a root spelled `/private/var`.
 */
function checkoutOf(from: string): string {
  try {
    const up = execFileSync('git', ['rev-parse', '--show-cdup'], {
      cwd: from,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return resolve(from, up);
  } catch {
    return from;
  }
}
