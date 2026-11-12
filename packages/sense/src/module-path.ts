/**
 * What a module id says without the file it names: its path, and whether its
 * build marked it as loaded and placed no probe in it. For a reader that holds
 * ids and no checkout, such as a watcher's listing.
 */

import type { ModuleId } from './instrument/index.js';
import moduleIds from './test-selection/module-id.cjs';

/** The repository-relative path an id names, or the whole id when it names no digest. */
export const modulePath: (id: ModuleId) => string = moduleIds.pathOf;

/** Whether an id names a module its build marked as loaded and placed no probe in. */
export const loadedUnprobed: (id: ModuleId) => boolean = moduleIds.isMarked;
