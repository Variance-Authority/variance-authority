import { kept } from '@variance-authority/sense/test-selection';

/** Explicit edited files for a whole local slice; undefined preserves the selected runner path. */
export function localNearFiles(selection, collected, edited, local) {
  if (!local || collected.length === 0 || kept(selection, collected).length !== new Set(collected).size) return undefined;
  const changed = new Set(edited);
  return collected.filter((file) => changed.has(file));
}
