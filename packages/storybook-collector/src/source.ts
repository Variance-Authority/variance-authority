/** Component attribution from the checkout's published native source index. */
import { resolve } from 'node:path';
import type { SourceIndex } from '@variance-authority/core/attribute';
import { publishedComponentSources } from '@variance-authority/sense';
import { isCI } from 'ci-info';
import { operatorError } from './operator.js';

export interface SourceScan {
  /** Published source directories, relative to `root` or absolute inside it. */
  readonly dirs: readonly string[];
}

/** Read component names and locations without walking or parsing source again. */
export async function scanSource(root: string, scan: SourceScan): Promise<SourceIndex> {
  try {
    const found = await publishedComponentSources(root, scan.dirs, {
      ci: isCI,
      step: 'variance index',
      announce: (line) => process.stderr.write(`variance: ${line}\n`),
    });
    if (found.files === 0) {
      throw new Error(`no published source files under ${scan.dirs.map((dir) => resolve(root, dir)).join(', ')}; every component would resolve to no file`);
    }
    return found.source;
  } catch (error) {
    throw operatorError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}
