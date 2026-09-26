/**
 * What may replace what on a line, and what a reader is told.
 *
 * Decided here, once, over the {@link LineCell} a backend provides, so a
 * directory, a bucket and a git ref hold a line by the same rules.
 */

import {
  decodeManifest,
  encodeManifest,
  entryDigest,
  entryProblem,
  parseEntryName,
  sameSlot,
  type BlobPath,
  type HeldEntry,
  type LineCell,
  type LineManifest,
  type ShareEntry,
  type ShareLine,
  type ShareMiss,
} from './line.js';

/**
 * Whether `descendant` strictly descends from `ancestor`, or `undefined` when
 * the history needed to say is not at hand. Git owns this answer; the caller
 * asks it.
 */
export type Descends = (descendant: string, ancestor: string) => Promise<boolean | undefined>;

/** What a publish did, entry by entry. */
export interface Published {
  /** Entries this publish wrote. */
  readonly written: readonly string[];
  /** Entries the line kept instead, and why. */
  readonly kept: readonly { readonly name: string; readonly commit: string; readonly because: 'newer-commit' | 'newer-format' }[];
  /**
   * Entries written although nobody could say whether the held one was newer.
   * Replacing is the answer then, because a line that refuses when it cannot
   * tell is a line one force-push jams for good.
   */
  readonly unanswered: readonly string[];
  /** How many times the manifest was read before a write held. */
  readonly attempts: number;
}

export interface PublishOptions {
  readonly descends: Descends;
  /** The bytes of an image the line does not hold yet, by digest. */
  readonly image: (digest: string) => Promise<Uint8Array>;
  /** Reads of the manifest before giving up on a line other writers keep moving. Defaults to 8. */
  readonly attempts?: number;
}

/**
 * Offer entries to a line.
 *
 * Each entry replaces the held entry in its slot — same family, same qualifier,
 * any version — except on a mainline, where the held one is kept when its
 * commit strictly descends from the offered one: a slow run of an older commit
 * finishing last. A held entry in a newer format is kept on any line, so an old
 * CLI cannot take a line back a version. Every other held entry is left as it
 * is, which is how suites published by different jobs land on one line.
 *
 * A write that loses to another writer reads the line again and decides again.
 */
export async function publishLine(
  cell: LineCell,
  line: ShareLine,
  entries: readonly ShareEntry[],
  options: PublishOptions,
): Promise<Published | ShareMiss> {
  for (const entry of entries) {
    const problem = entryProblem(entry);
    if (problem !== undefined) throw new Error(`cannot publish ${problem}`);
  }

  const limit = options.attempts ?? 8;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    const loaded = await cell.load(line);
    let held: LineManifest;
    let expected: string | undefined;
    if ('manifest' in loaded) {
      const decoded = decodeManifest(loaded.manifest);
      // A line a newer writer owns is not this writer's to replace; one that is
      // unreadable is, since nothing can read it anyway.
      if ('kind' in decoded) {
        if (decoded.kind === 'newer') return decoded;
        held = { format: 1, entries: [] };
      } else {
        held = decoded;
      }
      expected = loaded.version;
    } else if (loaded.kind === 'absent') {
      held = { format: 1, entries: [] };
    } else {
      return loaded;
    }

    const plan = await decide(line, held, entries, options.descends);
    if (plan.write.length === 0) {
      return { written: [], kept: plan.kept, unanswered: [], attempts: attempt };
    }

    const next = nextManifest(held, plan.write);
    const blobs = await blobsFor(held, next, plan.write, options.image);
    const outcome = await cell.store(line, {
      manifest: encodeManifest(next),
      blobs,
      ...(expected !== undefined ? { expected } : {}),
    });
    if (outcome === 'written') {
      return {
        written: plan.write.map((entry) => entry.name),
        kept: plan.kept,
        unanswered: plan.unanswered,
        attempts: attempt,
      };
    }
    if (outcome !== 'conflict') return outcome;
  }
  return {
    kind: 'unreachable',
    detail: `the line moved under ${String(limit)} writes in a row; nothing was published`,
  };
}

async function decide(
  line: ShareLine,
  held: LineManifest,
  entries: readonly ShareEntry[],
  descends: Descends,
): Promise<{ write: ShareEntry[]; kept: Published['kept'][number][]; unanswered: string[] }> {
  const write: ShareEntry[] = [];
  const kept: Published['kept'][number][] = [];
  const unanswered: string[] = [];
  for (const entry of entries) {
    const offered = parseEntryName(entry.name)!;
    let occupant: HeldEntry | undefined;
    let version = 0;
    for (const candidate of held.entries) {
      const slot = parseEntryName(candidate.name)!;
      if (sameSlot(slot, offered) && slot.version > version) {
        occupant = candidate;
        version = slot.version;
      }
    }
    if (occupant === undefined) {
      write.push(entry);
      continue;
    }
    if (version > offered.version) {
      kept.push({ name: occupant.name, commit: occupant.commit, because: 'newer-format' });
      continue;
    }
    if (line.kind === 'branch' || occupant.commit === entry.commit) {
      write.push(entry);
      continue;
    }
    const newer = await descends(occupant.commit, entry.commit);
    if (newer === true) {
      kept.push({ name: occupant.name, commit: occupant.commit, because: 'newer-commit' });
      continue;
    }
    if (newer === undefined) unanswered.push(entry.name);
    write.push(entry);
  }
  return { write, kept, unanswered };
}

function nextManifest(held: LineManifest, write: readonly ShareEntry[]): LineManifest {
  const replaced = write.map((entry) => parseEntryName(entry.name)!);
  const survivors = held.entries.filter(
    (entry) => !replaced.some((slot) => sameSlot(slot, parseEntryName(entry.name)!)),
  );
  const added: HeldEntry[] = write.map((entry) => ({
    name: entry.name,
    commit: entry.commit,
    ...(entry.head !== undefined ? { head: entry.head } : {}),
    ...(entry.images !== undefined ? { images: [...new Set(entry.images)] } : {}),
    digest: entryDigest(entry.bytes),
    size: entry.bytes.length,
  }));
  return { format: 1, entries: [...survivors, ...added] };
}

/** Only what the held line lacks: entry bytes are new by construction, images often are not. */
async function blobsFor(
  held: LineManifest,
  next: LineManifest,
  write: readonly ShareEntry[],
  image: (digest: string) => Promise<Uint8Array>,
): Promise<Map<BlobPath, Uint8Array>> {
  const blobs = new Map<BlobPath, Uint8Array>();
  const heldDigests = new Set(held.entries.map((entry) => entry.digest));
  for (const entry of write) {
    const digest = entryDigest(entry.bytes);
    if (!heldDigests.has(digest)) blobs.set(`entries/${digest}`, entry.bytes);
  }
  const heldImages = new Set(held.entries.flatMap((entry) => entry.images ?? []));
  for (const digest of new Set(next.entries.flatMap((entry) => entry.images ?? []))) {
    if (!heldImages.has(digest)) blobs.set(`images/${digest}`, await image(digest));
  }
  return blobs;
}

/** A line as a reader holds it: the manifest, and its blobs on demand. */
export interface HeldLine {
  readonly line: ShareLine;
  readonly manifest: LineManifest;
  /** The bytes of one entry, checked against the digest the manifest names. */
  entry(entry: HeldEntry): Promise<Uint8Array | ShareMiss>;
  image(digest: string): Promise<Uint8Array | ShareMiss>;
}

/** Read what a line holds, or why it cannot be read. */
export async function readLine(cell: LineCell, line: ShareLine): Promise<HeldLine | ShareMiss> {
  const loaded = await cell.load(line);
  if (!('manifest' in loaded)) return loaded;
  const manifest = decodeManifest(loaded.manifest);
  if ('kind' in manifest) return manifest;
  return {
    line,
    manifest,
    async entry(entry) {
      const bytes = await cell.blob(line, `entries/${entry.digest}`);
      if (!(bytes instanceof Uint8Array)) return bytes;
      if (entryDigest(bytes) !== entry.digest) {
        return { kind: 'unreadable', detail: `${entry.name}: the bytes do not match the manifest's digest` };
      }
      return bytes;
    },
    image(digest) {
      return cell.blob(line, `images/${digest}`);
    },
  };
}

/**
 * The held entry a reader asked for by name, or why there is none.
 *
 * A reader of `suite-v1/web` that finds `suite-v2/web` is told `newer`, not
 * `absent`: the line has what it wants, in a format it has to upgrade to read.
 */
export function findEntry(manifest: LineManifest, name: string): HeldEntry | ShareMiss {
  const wanted = parseEntryName(name);
  if (wanted === undefined) throw new Error(`"${name}" is not <family>-v<version>[/<qualifier>]`);
  const exact = manifest.entries.find((entry) => entry.name === name);
  if (exact !== undefined) return exact;
  const newer = manifest.entries
    .filter((entry) => {
      const held = parseEntryName(entry.name)!;
      return sameSlot(held, wanted) && held.version > wanted.version;
    })
    .map((entry) => entry.name);
  return newer.length > 0 ? { kind: 'newer', names: newer } : { kind: 'absent' };
}

/**
 * A line cell in this process, for tests and for a run that shares with itself.
 *
 * Holds real versions, so a test can stage a writer that moves the line between
 * another writer's read and its write.
 */
export function memoryLineCell(): LineCell & { readonly held: Map<string, Uint8Array> } {
  const held = new Map<string, Uint8Array>();
  const versions = new Map<string, number>();
  const key = (line: ShareLine): string => `${line.kind}\u0000${line.name}`;
  return {
    held,
    async load(line) {
      const manifest = held.get(`${key(line)}\u0000manifest`);
      if (manifest === undefined) return { kind: 'absent' };
      return { manifest, version: String(versions.get(key(line)) ?? 0) };
    },
    async blob(line, path) {
      const bytes = held.get(path.startsWith('images/') ? path : `${key(line)}\u0000${path}`);
      return bytes === undefined ? { kind: 'absent' } : bytes.slice();
    },
    async store(line, write) {
      const current = versions.get(key(line));
      const now = current === undefined ? undefined : String(current);
      if (now !== write.expected) return 'conflict';
      for (const [path, bytes] of write.blobs) {
        held.set(path.startsWith('images/') ? path : `${key(line)}\u0000${path}`, bytes.slice());
      }
      held.set(`${key(line)}\u0000manifest`, write.manifest.slice());
      versions.set(key(line), (current ?? 0) + 1);
      return 'written';
    },
  };
}
