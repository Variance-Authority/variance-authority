import { findEntry, readLine, type HeldEntry, type LineCell, type ShareLine, type ShareMiss } from '@variance-authority/core/share';
import type { Config } from '../config.js';
import { distanceFrom, lineCellOf, mergeBase, readerMainline, READ_REUSE_MS, type Unconfigured } from '../share-lines.js';
import type { Here } from './share.js';

/**
 * Reading one entry from a line, and from the reader's mainline: the record at
 * the checkout's merge base when the share keeps one there, else the latest.
 */

/**
 * Why the reader's mainline did not answer: the share's own account, or that
 * nothing names a mainline, a share, or the credential the share was given.
 */
export type MainlineMiss = ShareMiss | Unconfigured;

/** Which mainline a read was about, and where its entry was derived. */
export interface MainlineAt {
  readonly mainline: string;
  readonly commit: string;
  /** Commits the entry is behind `HEAD`'s merge base with the mainline; negative when ahead. */
  readonly distance?: number;
}

/**
 * Which mainline was asked and why it did not answer. `holds` names what the
 * line does hold when the miss is an entry it lacks, rather than the line.
 */
export interface MainlineMissed {
  readonly mainline?: string;
  readonly miss: MainlineMiss;
  readonly holds?: readonly string[];
}

/**
 * Where the reader's mainline holds `name`, and a way to read its bytes.
 *
 * The mainline is the one named, or else the one `readerMainline` chooses, and
 * the record is the one kept at `HEAD`'s merge base with it before the latest. The
 * bytes are read only when asked, because a commit this machine already holds
 * is answered from disk.
 */
export async function mainlineEntry(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  name: string | readonly string[],
  options: Here & { readonly mainline?: string; readonly base?: string },
): Promise<{ readonly at: MainlineAt; readonly held: LineEntry } | MainlineMissed> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  let { mainline, base } = options;
  if (mainline === undefined) {
    const chosen = await readerMainline(config, env, cwd);
    if ('missing' in chosen) {
      return { miss: { kind: 'unconfigured', detail: `nothing answered from ${chosen.missing.join(', ')}` } };
    }
    ({ name: mainline, base } = chosen);
  }
  const cell = await lineCellOf(config, { cwd, reuseMs: READ_REUSE_MS });
  if (cell === undefined) return { mainline, miss: { kind: 'unconfigured', detail: 'no share is configured' } };
  if ('kind' in cell) return { mainline, miss: cell };
  // The record at the merge base measures the code this checkout has. The
  // latest answers when it is that record, when none is kept there
  // (`at-commit.ts` in core's share), and alone in a store that keeps none by
  // commit. A latest that missed is written before anything kept beside it,
  // so the miss is the answer.
  const latest = await entryIn(cell, { kind: 'mainline', name: mainline }, name);
  if (cell.commits !== undefined && 'entry' in latest) base ??= await mergeBase(config, mainline, cwd);
  const atBase =
    cell.commits === undefined || base === undefined || !('entry' in latest) || latest.entry.commit === base
      ? undefined
      : await entryIn(cell, { kind: 'mainline', name: mainline, at: base }, name);
  const found = atBase === undefined || ('miss' in atBase && atBase.miss.kind === 'absent') ? latest : atBase;
  if ('miss' in found) return { mainline, ...found };

  const distance = await distanceFrom(config, mainline, found.entry.commit, cwd, base);
  return { at: { mainline, commit: found.entry.commit, ...(distance !== undefined ? { distance } : {}) }, held: found };
}

/** One entry a line holds, and its bytes and images on demand. */
export interface LineEntry {
  readonly entry: HeldEntry;
  readonly bytes: () => Promise<Uint8Array | ShareMiss>;
  readonly image: (digest: string) => Promise<Uint8Array | ShareMiss>;
}

/**
 * Where `line` holds `name`, or the first of a list it holds, or the first's miss.
 *
 * An `absent` entry on a line that exists carries what the line does hold, so
 * a reader can say *it holds suite-index-v2* rather than *nothing is
 * published*, which would send somebody to look for a publish that happened.
 */
export async function lineEntry(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  line: ShareLine,
  name: string | readonly string[],
  cwd: string,
): Promise<LineEntry | { readonly miss: MainlineMiss; readonly holds?: readonly string[] }> {
  const cell = await lineCellOf(config, { cwd, reuseMs: READ_REUSE_MS });
  if (cell === undefined) return { miss: { kind: 'unconfigured', detail: 'no share is configured' } };
  if ('kind' in cell) return { miss: cell };
  return entryIn(cell, line, name);
}

async function entryIn(
  cell: LineCell,
  line: ShareLine,
  name: string | readonly string[],
): Promise<LineEntry | { readonly miss: MainlineMiss; readonly holds?: readonly string[] }> {
  const held = await readLine(cell, line);
  if ('kind' in held) return { miss: held };
  const found = (typeof name === 'string' ? [name] : name).map((one) => findEntry(held.manifest, one));
  const entry = found.find((one) => !('kind' in one)) ?? found[0]!;
  if ('kind' in entry) return entry.kind === 'absent' ? { miss: entry, holds: held.manifest.entries.map((one) => one.name) } : { miss: entry };
  return { entry, bytes: () => held.entry(entry), image: (digest) => held.image(digest) };
}
