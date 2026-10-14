// compass: variance-authority.retention

import { readdir } from 'node:fs/promises';
import { identityDigest, type RenderIdentity } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { orAbsent } from './absent.js';
import { identityOfPartition } from './legacy.js';

/**
 * Whether two identities paint one line of baselines: one engine family, on one
 * platform, at one scale. An engine build, the fonts or this tool's recipe move
 * along a line. The renderer is not part of a line: a local and a remote
 * renderer of one engine on one platform paint the same image.
 *
 * A path keeps one baseline per engine family, so a line no longer decides
 * where a file goes. It still decides which of several old-layout copies an
 * upgrade reads first: the one this machine's line painted, because another
 * line's copy would blame the machine for a change the upgrade made.
 */
export function sameLine(a: RenderIdentity, b: RenderIdentity): boolean {
  return (
    familyOf(a.engine) === familyOf(b.engine) &&
    a.platform === b.platform &&
    a.deviceScaleFactor === b.deviceScaleFactor
  );
}

/** `chromium@131.0.0` is `chromium`; an engine with no build names its family whole. */
export function familyOf(engine: string): string {
  const at = engine.indexOf('@');
  return at === -1 ? engine : engine.slice(0, at);
}

/**
 * The partition directories in a holder, in code-unit order, or none because nobody wrote one.
 *
 * Scanned in the **record** root rather than the image root: every baseline has
 * a record and only a pictured one has an image. A holder that does not exist
 * is a legitimate empty answer. One that exists and cannot be listed throws,
 * because this scan alone stands between an upgrade and every subject reported
 * `new`.
 */
export async function identities(holder: string): Promise<readonly string[]> {
  const entries = await orAbsent(() => readdir(holder, { withFileTypes: true }), holder);
  if (entries === null) return [];
  return entries
    .filter((entry) => entry.isDirectory() && identityOfPartition(entry.name) !== undefined)
    .map((entry) => entry.name)
    .sort(codeUnitOrder);
}

/**
 * How near a stored identity is to this machine's, nearest first: the same
 * identity, the same line, the same engine family, anything else.
 */
export function nearness(stored: RenderIdentity, mine: RenderIdentity): 0 | 1 | 2 | 3 {
  if (identityDigest(stored) === identityDigest(mine)) return 0;
  if (sameLine(stored, mine)) return 1;
  return familyOf(stored.engine) === familyOf(mine.engine) ? 2 : 3;
}
