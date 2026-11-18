/** Component attribution from the checkout's source index, brought up to the checkout first. */
import { resolve } from 'node:path';
import type { SourceIndex } from '@variance-authority/core/attribute';
import { publishedComponentSources } from '@variance-authority/sense';
import { isCI } from 'ci-info';
import { operatorError } from './operator.js';

export interface SourceScan {
  /** Published source directories, relative to `root` or absolute, anywhere inside its checkout. */
  readonly dirs: readonly string[];
  /** Defaults to `.tsx`, `.jsx`, `.ts`, `.js`. */
  readonly extensions?: readonly string[];
  /** Skipped anywhere in a path. Defaults to tests, stories, `dist/` and `node_modules`, which declare no component whatever is named here. */
  readonly exclude?: readonly string[];
}

/** Component names and locations as the source is on disk: the index absorbs what moved, and nothing unchanged is parsed again. */
export async function scanSource(root: string, scan: SourceScan): Promise<SourceIndex> {
  try {
    const found = await publishedComponentSources(root, scan.dirs, {
      ci: isCI,
      step: 'variance index',
      announce: (line) => process.stderr.write(`variance: ${line}\n`),
      ...(scan.extensions === undefined ? {} : { extensions: scan.extensions }),
      ...(scan.exclude === undefined ? {} : { exclude: scan.exclude }),
    });
    if (found.files === 0) {
      throw new Error(`no source files under ${scan.dirs.map((dir) => resolve(root, dir)).join(', ')}; every component would resolve to no file`);
    }
    return found.source;
  } catch (error) {
    throw operatorError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}
