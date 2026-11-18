/** Component attribution and source identity from one native publication. */
// compass: variance-authority.normalization.declaration-index
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SourceIndex, SourceRef } from '@variance-authority/core/attribute';
import { entry } from './help-reading.js';
import { publishedThrough, type PublishedSourcesOptions } from './published.js';
import { realPath } from './resolve.js';

/** Attribution and collection identity derived from the same source publication. */
export interface PublishedComponentSources {
  readonly source: SourceIndex;
  readonly files: number;
  readonly digest: string;
}

/**
 * Read component references and source identity from one published generation.
 * `dirs` are repository-relative or absolute inside `root`; outside paths are refused.
 * Missing publications follow `options`' local/CI policy. A file without a content identity is refused.
 * @see {@link https://variance-authority.dev/docs/source-index#reading-it | Reading the source index}
 */
export async function publishedComponentSources(root: string, dirs: readonly string[], options: PublishedSourcesOptions): Promise<PublishedComponentSources> {
  const spelled = resolve(root);
  const where = realPath(spelled);
  const outside = (path: string): boolean => isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`);
  const scoped = dirs.map((dir) => {
    const named = relative(spelled, resolve(spelled, dir));
    const target = outside(named) ? resolve(spelled, dir) : resolve(where, named);
    const path = relative(where, realPath(target));
    if (outside(path)) throw new Error(`source directory "${dir}" is outside the repository`);
    return path.split(sep).join('/') || '.';
  });
  const read = await publishedThrough(where, options, async (path) => {
    const opened = entry('openIndex')(path);
    try {
      const status = opened.status();
      return { ...status, value: status.state === 'published' ? opened.componentSources(scoped) : undefined };
    } finally { opened.close(); }
  });
  if (read.value === undefined) throw new Error('the source index was not published by its update');
  const source: Record<string, SourceRef[]> = {};
  for (const { name, file, line, via } of read.value.components) (source[name] ??= []).push({ file, line, via });
  return { source, files: read.value.files, digest: read.value.digest };
}
