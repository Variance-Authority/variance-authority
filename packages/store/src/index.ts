/**
 * `@variance-authority/store` — baselines on a filesystem.
 *
 * Two backends, one requirement: a directory this process may write to. The
 * durable store owns the layout; the git-LFS store owns the layout *and* a `git`
 * on the path, which is why it is a separate module and a separate entrypoint —
 * a consumer keeping baselines in a plain directory should not be one import away
 * from shelling out.
 *
 * Everything about what a baseline *means* — the contract, the refusal, the
 * checks a stored record passes before it is believed — is in
 * `@variance-authority/raster`, which needs nothing. That split is the reason a
 * verdict cannot depend on where the bytes were kept.
 */

export { createDurableStore } from './durable.js';

export { createLfsStore } from './lfs.js';
export type {
  CommandResult,
  CommandRunner,
  LfsStore,
  LfsStoreOptions,
  LfsTracking,
} from './lfs.js';
