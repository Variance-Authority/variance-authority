// compass: variance-authority.retention

import { RasterStoreError, type BaselineKey } from '@variance-authority/raster';
import type { BaselinePathTemplate } from './path-template.js';

/**
 * One path, one baseline: who a file-backed baseline was placed for, and the
 * refusal when a second subject's path is the same file.
 *
 * A template is not injective — two stories with one name under one title, or
 * one test run by two Playwright projects, render one path — and a file that
 * held both would hand each the other's image as its baseline. Never
 * renumbered: a suffix decided by which subject asked first is a path that
 * changes when the plan's order does, and then the baseline a reviewer
 * approved belongs to the other subject.
 *
 * Checked twice. A store holds the paths it answered for in memory, which
 * catches two subjects of one run. And the `.json` record names the subject it
 * was placed for, which catches the ones a store never sees together: a shard,
 * a subject the plan skipped, another Playwright worker.
 */

/** Who a baseline was placed for: the key's identity, without where it is filed. */
export interface PlacedFor {
  readonly subject: string;
  readonly label?: string;
  readonly project?: string;
}

export function placedForOf(key: BaselineKey): PlacedFor {
  return {
    subject: key.subject,
    ...(key.label === undefined ? {} : { label: key.label }),
    ...(key.project === undefined ? {} : { project: key.project }),
  };
}

/** The `placedFor` a record carries, or `undefined` for one written before records named it. */
export function placedForIn(record: unknown): PlacedFor | undefined {
  if (typeof record !== 'object' || record === null) return undefined;
  const placed = (record as { placedFor?: unknown }).placedFor;
  if (typeof placed !== 'object' || placed === null) return undefined;
  const { subject, label, project } = placed as Record<string, unknown>;
  if (typeof subject !== 'string') return undefined;
  return {
    subject,
    ...(typeof label === 'string' ? { label } : {}),
    ...(typeof project === 'string' ? { project } : {}),
  };
}

function same(a: PlacedFor, b: PlacedFor): boolean {
  return a.subject === b.subject && a.label === b.label && a.project === b.project;
}

interface Claim {
  readonly placed: PlacedFor;
  readonly path: string;
}

/** The paths a store has answered for, case-folded because a checkout on macOS or Windows folds them. */
export type Claims = Map<string, Claim>;

/** Hold `path` for `key`, or refuse it by name when another key holds it. */
export function claim(claims: Claims, key: BaselineKey, path: string, template: BaselinePathTemplate): void {
  const folded = path.normalize('NFC').toLowerCase();
  const holder = claims.get(folded);
  const placed = placedForOf(key);
  if (holder === undefined) {
    claims.set(folded, { placed, path });
    return;
  }
  if (same(holder.placed, placed)) return;
  // Both spellings, because two paths that differ only in case are one file
  // on the checkout that folds them, and the reader is looking at the other.
  const at = holder.path === path ? path : `${holder.path} and ${path}`;
  throw new RasterStoreError(
    `${named(holder.placed)} and ${named(placed)} both place their baseline at ${at} under ` +
      `baselines.path ${JSON.stringify(template.source)}, and one file cannot hold two baselines. ` +
      remedy(holder.placed, placed),
  );
}

/**
 * Refuse a path whose record says another subject's baseline is there.
 *
 * A record that names nobody was written before records did, and is not
 * checked: the in-memory claim is all it gets. Nor is one placed for a project
 * the runner no longer has, when the caller says which it has: no run will
 * place for that project again, so its record is a renamed project's baseline,
 * and the project that took its place takes it over.
 */
export function refuseOccupied(
  record: PlacedFor | undefined,
  key: BaselineKey,
  path: string,
  template: BaselinePathTemplate,
  projects?: ReadonlySet<string>,
): void {
  const placed = placedForOf(key);
  if (record === undefined || same(record, placed)) return;
  if (record.project !== undefined && projects !== undefined && !projects.has(record.project)) return;
  throw new RasterStoreError(
    `the baseline at ${path} was accepted for ${named(record)}, and ${named(placed)} places its ` +
      `baseline at the same path under baselines.path ${JSON.stringify(template.source)}; ` +
      `one file cannot hold two baselines. ${remedy(record, placed)} ${renamed(record, placed, path)}`,
  );
}

/** The other way out: the record's holder is this key under its old name. */
function renamed(record: PlacedFor, placed: PlacedFor, path: string): string {
  const was =
    record.subject !== placed.subject
      ? `${JSON.stringify(placed.subject)} is ${JSON.stringify(record.subject)} renamed`
      : `project ${JSON.stringify(placed.project ?? '')} is ${JSON.stringify(record.project ?? '')} renamed`;
  return `If ${was}, delete ${path}.json and the image beside it and accept again.`;
}

function named(placed: PlacedFor): string {
  return (
    `subject ${JSON.stringify(placed.subject)}` +
    (placed.label === undefined ? '' : ` (${placed.label})`) +
    (placed.project === undefined ? '' : ` in project ${JSON.stringify(placed.project)}`)
  );
}

/** The token that would tell the two apart. */
function remedy(a: PlacedFor, b: PlacedFor): string {
  if (a.subject === b.subject && a.label === b.label) {
    return (
      'Two Playwright projects that differ only in what a baseline path does not name — a scale factor, ' +
      'a colour scheme, a viewport — paint two images of one test. Put {project} into baselines.path, ' +
      'e.g. "{project}/{title}/{name}-{engine}", so each project keeps its own.'
    );
  }
  return 'Rename one of them, or put a token that tells them apart into baselines.path: {file}, {title}, {id} or {project}.';
}
