// compass: variance-authority.retention

import { identityDigest, type RenderIdentity } from '@variance-authority/core/format';
import { said } from '../here.js';
import type { Config } from '../config.js';
import type { DoctorProbes } from './doctor-probes.js';

/**
 * Doctor's store half: what the baseline store holds, read from the disk alone.
 *
 * Split from `doctor.ts` along the seam the remote renderer already cut, where
 * the store is read with no renderer open, so it can be asked on its own:
 * `variance doctor --baselines` opens no browser and measures no font. The
 * composite action asks it before every run over a store in the checkout,
 * because the one finding here that stops a run, an LFS store checked out as
 * pointers, is the one the run meets only at a subject whose document moved.
 */

export interface BaselineFinding {
  readonly kind: 'ephemeral' | 'directory' | 'lfs' | 'remote';
  readonly because: string;

  /**
   * Whether this machine painted any baseline in this store.
   *
   * `false` is the finding that costs an afternoon everywhere else: a run here
   * compares every subject against another machine's image (ADR-0090), and
   * every change it reports names the machine as its cause. Read from each
   * record's identity at the paths `baselines.path` renders, and from the
   * directory name of an identity-directory baseline,
   * `<…>/<identityDigest>/<subject>.webp`, or the `.png` kept before.
   *
   * Absent when nothing was looked at: a remote store is not contacted, and an
   * ephemeral run keeps no baselines.
   */
  readonly paintedHere?: boolean;

  /** What the store holds, per identity, most baselines first. Absent when not scanned. */
  readonly partitions?: readonly Partition[];

  /** LFS pointers checked out where images should be, relative to the root. Absent when none. */
  readonly pointers?: readonly string[];
}

export interface Partition {
  /** The `identityDigest` the directory is named for. */
  readonly identity: string;
  readonly baselines: number;
  /** Whether this is the identity a renderer opened here would write under. */
  readonly mine: boolean;
  /**
   * How many of them sit in a directory named with the raw `v1:` digest, which
   * the store still reads and Windows cannot check out. Absent when none do.
   */
  readonly colonSpelled?: number;
}

/**
 * What the configured store holds. With `identity`, which of its partitions
 * this machine would write under; without one, as `--baselines` and a remote
 * renderer ask it, the partitions are counted and none is called this
 * machine's.
 */
export async function baselineFinding(
  config: Config,
  probes: DoctorProbes,
  identity?: RenderIdentity,
): Promise<BaselineFinding> {
  if (config.retention === 'ephemeral' || config.baselines === undefined) {
    return {
      kind: 'ephemeral',
      because:
        'nothing is stored: both images are produced in one run by one renderer, so the ' +
        'machine cancels out by construction and no baseline can be compared across it',
    };
  }

  const store = config.baselines;
  if (store.kind === 'remote') {
    return {
      kind: 'remote',
      because: `remote ${store.endpoint}, not contacted`,
    };
  }

  const present = await probes.exists(store.root);
  if (!present) {
    return {
      kind: store.kind,
      because:
        `${said(store.root)} does not exist yet, so every subject will be \`new\` on the first ` +
        'run here — which is not a regression and is not a pass',
    };
  }

  // Before the partition count, which is a `readdir` and counts a pointer as a
  // baseline. The run meets a pointer only for a subject whose document moved.
  const pointers = store.kind === 'lfs' ? await probes.pointers(store.root) : [];
  if (pointers.length > 0) {
    return {
      kind: store.kind,
      because:
        `${pointers.length} of the images under ${said(store.root)} are git-LFS pointers, not ` +
        `images (first: ${pointers[0]}). This clone was checked out without git-lfs, so a run ` +
        'refuses the first subject that compares against one. Run `git lfs install && git lfs pull`',
      pointers,
    };
  }

  const scanned = await probes.partitions(store.root);
  const stored = scanned.reduce((total, entry) => total + entry.baselines, 0);

  // An empty root is the first run, not the wrong machine, and the two produce
  // opposite advice from the same `readdir`. Nothing to compare against is why
  // every subject will be `new`; nothing *of this machine's* to compare against
  // is why every subject would change, with the machine named as the cause.
  // Collapsing them would tell a
  // developer setting the tool up for the first time that their machine is wrong.
  if (stored === 0) {
    return {
      kind: store.kind,
      because:
        `${said(store.root)} exists and holds no baseline yet, so every subject will be \`new\` ` +
        'on the first run here — which is not a regression and is not a pass',
    };
  }

  if (identity === undefined) {
    // No renderer opened, so there is no digest to compare against, and saying
    // the machine differs would be inventing the bad news rather than finding it.
    return {
      kind: store.kind,
      because:
        `${said(store.root)} holds ${stored} baseline(s) across ${scanned.length} machine ` +
        'identit(ies). Which of them is this machine cannot be said, because no renderer ' +
        'opened here to be asked',
      partitions: scanned.map((entry) => ({ ...entry, mine: false })),
    };
  }

  const mine = identityDigest(identity);
  const partitions = scanned.map((entry) => ({ ...entry, mine: entry.identity === mine }));
  const ours = partitions.find((entry) => entry.mine);

  if (ours !== undefined) {
    return {
      kind: store.kind,
      paintedHere: true,
      because:
        `${ours.baselines} baseline(s) in ${said(store.root)} match this machine${
          partitions.length > 1 ? `; ${partitions.length - 1} other identit(ies) left alone` : ''
        }`,
      partitions,
    };
  }

  // FIXME: a store whose baselines differ from this machine only in the recipe
  // digests (stabilization, rasterization), as every baseline does after an
  // upgrade that moves them, is told the machine differs. The run names the
  // recipe as the cause (ADR-0090); this compares the whole digest and cannot
  // say so. The partition directory names a digest, not the identity behind it,
  // so telling the two apart here needs a sidecar read per partition.
  return {
    kind: store.kind,
    // The finding this command was worth writing for. Everything else here is a
    // prerequisite somebody can check by hand in a minute; this one is invisible
    // until a run reports every subject changed, and then it looks like the
    // product broke.
    paintedHere: false,
    because:
      `no baseline in ${said(store.root)} was painted by a machine like this one. This machine is ` +
      `${mine.slice(0, 12)}… and the store holds ${stored} baseline(s) under ` +
      `${scanned.length} other identit(ies), so every subject is compared against another ` +
      "machine's image and the machine is named as the cause of whatever moved. Two ways to keep " +
      'it out of the diff: set `"retention": "ephemeral"` so both images are painted here in one ' +
      'run, or point `"renderer"` at an endpoint running the identity the baselines were written under',
    partitions,
  };
}
