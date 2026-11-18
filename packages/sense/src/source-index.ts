// compass: variance-authority.reach.source-index
import { resolve } from 'node:path';
import { cacheLayers } from './test-selection/cache-layers.js';
import { realPath } from './resolve.js';
/** The checkout's own source index, shared by every native reader and updater. */
export function sourceIndexPath(root: string, cacheRoot?: string): string {
  return resolve(cacheLayers(realPath(resolve(root)), cacheRoot).top, 'source-index.bin');
}
