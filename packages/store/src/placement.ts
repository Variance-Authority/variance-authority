// compass: variance-authority.retention

import { join } from 'node:path';
import { fileNameFor, type Digest } from '@variance-authority/core/format';
import { RasterStoreError, type BaselineKey } from '@variance-authority/raster';

/**
 * Where a baseline's file goes, and the refusals that keep it under the root.
 *
 * Split out of `durable.ts` because it is the one part of a file-backed store
 * that decides nothing about a verdict
 * ([ADR-0016](../../../docs/context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)):
 * every function here answers *which path*, and none of them reads or writes
 * one. `lfs.ts` places identically by construction, because it is `durable.ts`
 * with a filter in front.
 */

/**
 * Where a subject's baseline sits under the root.
 *
 * `flat` is the original and the default: every image for the root lives under
 * one identity directory, and a subject id with slashes in it is percent-encoded
 * into a single filename. It is the placement to take when the baselines are a
 * corpus — a directory somebody backs up, prunes, or points a bucket at.
 *
 * `beside` puts the image in the directory holding the code it is an image of,
 * which is what puts it in the same review, the same move and the same delete as
 * that code. It takes the directory from the key's `path` when the plan supplied
 * one — a story knows the file that declares it — and otherwise spends the
 * subject id's own slashes instead of encoding them, so `components/Button/primary`
 * lands in `components/Button/`. `docs/placement.md` is the page that chooses
 * between them.
 *
 * The identity partition is unchanged either way — it moves down to the leaf
 * directory rather than disappearing, because a baseline painted by another
 * machine must still be in a directory this one does not read
 * ([ADR-0011](../../../docs/context/adr/0011-durable-and-ephemeral-retention.md)).
 */
export type BaselineLayout = 'flat' | 'beside';

/**
 * What an identity directory is named, so a scan can tell one from a neighbour.
 *
 * `flat` never needed this — everything under the root was a partition. `beside`
 * puts partitions among the subject's own siblings, where `Button/` and
 * `by-document/` are directories too, and a sibling scan that reported them as
 * machine identities would answer `incomparable` naming a component.
 */
export const IDENTITY_DIRECTORY = /^v1:[0-9a-f]{32}$/;

export function pathFor(holder: string, identity: Digest, key: BaselineKey, layout: BaselineLayout): string {
  return join(holder, identity, fileNameFor(fileName(key, layout)));
}

/**
 * The directory holding this key's identity partitions.
 *
 * `flat` answers the root for every key, which is what makes one `readdir` the
 * whole sibling scan. `beside` answers the subject's own directory, so the scan
 * that turns a wrong-machine run into `incomparable` reads that directory rather
 * than the tree — cheaper, and scoped to the subject actually being asked about.
 *
 * A carried `path` wins over the id, because it is the better answer whenever
 * both exist: the id is what the subject is called and the path is where its
 * code lives, and only a `list` collector that named its subjects after
 * directories makes those the same string.
 */
export function holder(root: string, layout: BaselineLayout, key: BaselineKey): string {
  if (layout === 'flat') return root;
  if (key.path !== undefined) return join(root, ...carried(key.subject, key.path));
  return join(root, ...segments(key.subject).slice(0, -1));
}

/**
 * The leaf, which is the whole id whenever the directory came from somewhere else.
 *
 * Splitting the id for a name too would take `story:components-button--primary`
 * down to itself and `a/b` down to `b`, and the second of those is only correct
 * because the `a/` it dropped is in the directory. A carried path drops nothing,
 * so the name keeps every character that made the id unique.
 */
export function fileName(key: BaselineKey, layout: BaselineLayout): string {
  const subject =
    layout === 'flat' || key.path !== undefined
      ? key.subject
      : (segments(key.subject).at(-1) as string);
  return key.label === undefined ? subject : `${subject}__${key.label}`;
}

/**
 * A subject id split into path segments, refusing the ones that escape the root.
 *
 * Only `beside` splits, and only `beside` can therefore be steered by a subject
 * id: a collector naming a subject `../../etc/hosts` would otherwise write a PNG
 * wherever the id said. `..`, an absolute id and an empty segment are refused by
 * name, because the alternative is a store whose write location is decided by
 * whatever produced the plan.
 */
export function segments(subject: string): readonly string[] {
  if (subject.startsWith('/')) {
    throw new RasterStoreError(`subject id ${JSON.stringify(subject)} is an absolute path`);
  }
  const parts = subject.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      throw new RasterStoreError(
        `subject id ${JSON.stringify(subject)} has a ${JSON.stringify(part)} segment, and a ` +
          '`beside` layout would write outside the baseline root. Use the `flat` layout, or ' +
          'give the subject an id that is a path.',
      );
    }
  }
  return parts;
}

/**
 * The same refusal, for a directory the plan carried rather than an id.
 *
 * Kept apart from {@link segments} for two reasons. The empty string is a
 * legitimate answer here and is not one there — a story declared at the root of
 * the repository has no directory above it, and refusing that would make the
 * root the one place a project cannot keep a component. And the message has to
 * name what the operator can act on: they chose a subject id, but the path came
 * off an artifact, so the sentence has to say which subject brought it.
 */
export function carried(subject: string, path: string): readonly string[] {
  if (path === '') return [];
  if (path.startsWith('/')) {
    throw new RasterStoreError(
      `subject ${JSON.stringify(subject)} carries the absolute path ${JSON.stringify(path)}, and ` +
        'a `beside` layout places under the baseline root. The collector that produced it owes ' +
        'a path relative to that root.',
    );
  }
  const parts = path.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      throw new RasterStoreError(
        `subject ${JSON.stringify(subject)} carries the path ${JSON.stringify(path)}, whose ` +
          `${JSON.stringify(part)} segment would place it outside the baseline root. The ` +
          'collector that produced it owes a normalized path relative to that root.',
      );
    }
  }
  return parts;
}
