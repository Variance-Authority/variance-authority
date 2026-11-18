/** Component attribution and source identity from one native publication. */
// compass: variance-authority.normalization.declaration-index
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SourceIndex, SourceRef } from '@variance-authority/core/attribute';
import { entry } from './help-reading.js';
import { publishedThrough, updateSourceIndex, type PublishedSourcesOptions } from './published.js';
import { realPath } from './resolve.js';
import { repositoryRoot } from './test-selection/repository-root.js';

/** Attribution and collection identity derived from the same source publication. */
export interface PublishedComponentSources {
  readonly source: SourceIndex;
  readonly files: number;
  readonly digest: string;
}

/** Which of the published files hold components, beside how the publication is reached. */
export interface ComponentSourcesOptions extends PublishedSourcesOptions {
  /** Defaults to `.tsx`, `.jsx`, `.ts`, `.js`. */
  readonly extensions?: readonly string[];
  /** Skipped anywhere in a path, for the identity too. Defaults to tests, stories, `dist/` and `node_modules`, which declare no component whatever is named here. */
  readonly exclude?: readonly string[];
}

/**
 * Read component references and source identity from the source index, brought
 * up to the checkout first, in CI too: attribution names the source as it is on
 * disk, so an edit after the last `variance index` is in the answer, and a
 * pipeline that never ran that step pays for the index here instead of failing.
 * The index is the checkout's, wherever in it `root` is: `dirs` are relative to
 * `root` or absolute, a sibling package's included, and each file is named from
 * `root`. A directory outside the checkout is refused.
 * An update that is refused leaves the publication to `options`' local/CI policy.
 * A file without a content identity is refused.
 * @see {@link https://variance-authority.dev/docs/source-index#reading-it | Reading the source index}
 */
export async function publishedComponentSources(root: string, dirs: readonly string[], options: ComponentSourcesOptions): Promise<PublishedComponentSources> {
  const spelled = resolve(root);
  const asked = realPath(spelled);
  const where = repositoryRoot(asked);
  const outside = (path: string): boolean => isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`);
  const scoped = dirs.map((dir) => {
    // Anchored on the real root before it is resolved: a directory that is not there has no real path of its own.
    const path = relative(where, realPath(resolve(asked, relative(spelled, resolve(spelled, dir)))));
    if (outside(path)) throw new Error(`source directory "${dir}" is outside the repository`);
    return path.split(sep).join('/') || '.';
  });
  const { refused, reread } = await updateSourceIndex(where, {
    ...(options.index === undefined ? {} : { index: options.index }),
    ...(options.packs === undefined ? {} : { packs: options.packs }),
  });
  if (refused === undefined && reread > 0) options.announce(`brought the source index of ${where} up to the checkout for component attribution: ${reread} ${reread === 1 ? 'file' : 'files'} read.`);
  if (refused !== undefined) options.announce(`the source index could not be updated to the checkout: ${refused}; reading it as it stands.`);
  const read = await publishedThrough(where, options, async (path) => {
    const opened = entry('openIndex')(path);
    try {
      const status = opened.status();
      return { ...status, value: status.state === 'published' ? opened.componentSources(scoped, options.extensions?.slice(), options.exclude?.slice()) : undefined };
    } finally { opened.close(); }
  });
  if (read.value === undefined) throw new Error('the source index was not published by its update');
  const source: Record<string, SourceRef[]> = {};
  for (const { name, file, line, via } of read.value.components) (source[name] ??= []).push({ file: relative(asked, resolve(where, file)).split(sep).join('/'), line, via });
  return { source, files: read.value.files, digest: read.value.digest };
}
