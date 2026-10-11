// compass: variance-authority.retention

import { readdir } from 'node:fs/promises';
import { identityDigest, type RenderIdentity } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { orAbsent } from './absent.js';
import { identityOfPartition, partitionsOf } from './placement.js';

/**
 * Whether two identities paint one line of baselines: one engine family, on one
 * platform, at one scale. An engine build, the fonts or this tool's recipe move
 * along a line; a write retires the line's older copy, so an upgrade moves the
 * baseline. A matrix of engines or machines is several lines, each keeping its own.
 * The renderer is not part of a line: a local and a remote renderer of one engine
 * on one platform paint the same image, so either one's write moves the other's.
 */
export function sameLine(a: RenderIdentity, b: RenderIdentity): boolean {
  return (
    familyOf(a.engine) === familyOf(b.engine) &&
    a.platform === b.platform &&
    a.deviceScaleFactor === b.deviceScaleFactor
  );
}

/** `chromium@131.0.0` is `chromium`; an engine with no build names its family whole. */
function familyOf(engine: string): string {
  const at = engine.indexOf('@');
  return at === -1 ? engine : engine.slice(0, at);
}

/**
 * The identities that have written here, in code-unit order, or none because nobody has.
 *
 * Scanned in the **record** root rather than the image root. Every baseline has
 * a record and only a pictured one has an image, so a scan of the images would
 * miss the identity that painted a subject with no pixels — and report `new` for
 * a subject another machine has already recorded, which is the exact sentence
 * this scan exists to prevent.
 *
 * A root that does not exist is a legitimate empty answer: the first run on a
 * fresh checkout creates it on `put`. A root that exists and cannot be listed
 * throws, because this scan alone compares a wrong-machine run against a
 * baseline instead of calling the subject `new` and re-recording it.
 */
export async function identities(holder: string): Promise<readonly string[]> {
  const entries = await orAbsent(() => readdir(holder, { withFileTypes: true }), holder);
  if (entries === null) return [];
  return entries
    .filter((entry) => entry.isDirectory() && identityOfPartition(entry.name) !== undefined)
    .map((entry) => entry.name)
    .sort(codeUnitOrder);
}

/** What a partition's record says painted it, or `null` when it holds no record of the subject. */
export type IdentityAt = (partition: string) => Promise<RenderIdentity | null>;

/**
 * The partitions a lookup reads, in the order it reads them, and whether each is this machine's.
 *
 * This machine's written name first and alone, so a hit costs no `readdir`.
 * Then this machine's raw-digest name, then this identity's line, then every
 * other line in code-unit order. The line comes first because it holds the
 * baseline an upgrade moves from; a neighbour's line would blame the machine
 * for a change the upgrade made.
 */
export async function* searched(
  holder: string,
  mine: RenderIdentity,
  identityAt: IdentityAt,
): AsyncGenerator<{ partition: string; comparable: boolean }> {
  const digest = identityDigest(mine);
  const [written, legacy] = partitionsOf(digest);
  yield { partition: written, comparable: true };
  const scanned = await identities(holder);
  if (scanned.includes(legacy)) yield { partition: legacy, comparable: true };
  const lined: string[] = [];
  const elsewhere: string[] = [];
  for (const other of scanned) {
    if (identityOfPartition(other) === digest) continue;
    const painter = await identityAt(other);
    if (painter !== null) (sameLine(painter, mine) ? lined : elsewhere).push(other);
  }
  for (const partition of [...lined, ...elsewhere]) yield { partition, comparable: false };
}
