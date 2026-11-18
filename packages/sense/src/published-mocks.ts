/** Sparse mock declarations from the published native source snapshot. */
// compass: variance-authority.reach.source-index
import { entry } from './help-reading.js';
import { publishedThrough, type PublishedSourcesOptions } from './published.js';

/**
 * Whether each asked file's published parse declares a mock or a real-load
 * addition. Reads those record and parse rows without opening source text or
 * constructing the selection graph; the usual publication policy applies.
 */
export async function publishedMocks(root: string, files: readonly string[], options: PublishedSourcesOptions): Promise<readonly boolean[]> {
  const read = await publishedThrough(root, options, async (path) => {
    const opened = entry('openIndex')(path);
    try {
      const status = opened.status();
      return { ...status, mocks: status.state === 'published' ? opened.hasMocks([...files]) : [] };
    } finally { opened.close(); }
  });
  return read.mocks;
}
