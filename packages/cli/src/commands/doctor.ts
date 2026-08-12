import { access, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import {
  identityDigest,
  type ProfileId,
  type RenderDocument,
  type RenderIdentity,
  type Viewport,
} from '@variance-authority/core';
import { createPlaywrightRenderer } from '@variance-authority/playwright';
import { SUBJECT_PATH, type Renderer } from '@variance-authority/raster';
import type { BrowserEngine, Config } from '../config.js';

/**
 * `variance doctor` — what *this* machine can observe, and nothing else.
 *
 * The command exists because of one failure mode. A durable visual suite is
 * machine-bound; when the machine is wrong, every subject fails at once, for
 * reasons that look like three hundred component regressions. Doctor is the
 * thing that turns that morning into one sentence.
 *
 * **It never guesses.** Every line of its output is something it observed on this
 * machine, now. There is no "should be fine", no version table consulted, no
 * inference from an installed package's metadata — a `playwright` in
 * `node_modules` is not a browser, and a browser on disk is not a browser that
 * launches. So the browser check *launches one*, and the font check *measures
 * text in it*, because those are the only two questions whose answers are facts
 * rather than expectations.
 *
 * **It does not touch the network.** The remote baseline store and the history
 * service are reported as *configured*, never as reachable. Contacting them would
 * make doctor's answer depend on a firewall's mood, and — worse — would make a
 * diagnostic command a thing that writes to somebody's service. What doctor can
 * say about them honestly is what the operator wrote down, which is what it says.
 *
 * ## The known limit, stated rather than discovered
 *
 * The font probe measures a sample string against three generic families. A
 * family that resolves changes the measurement; a family that does not measures
 * identically to the generic. That is the only signal available from inside a
 * page — `document.fonts.check` answers "will something be painted", which is
 * always yes.
 *
 * The consequence: **a font that is genuinely metric-compatible with a generic is
 * reported missing.** Arimo, Liberation Sans, and the substitute stacks a Linux
 * container ships precisely so that layout does not move all read as absent. This
 * is a false alarm, it errs toward reporting a doubt rather than swallowing one,
 * and it is why a missing font here does *not* change the exit code — a
 * diagnostic that fails CI on a false positive is a diagnostic that gets removed.
 * The reliable answer needs the font bytes, which is why font identities are
 * caller-supplied content hashes (spec §11.1) rather than anything a page saw.
 */

export interface Diagnosis {
  readonly profile: ProfileId;
  readonly renderer: RendererFinding;
  readonly fonts: FontFinding;
  readonly baselines: BaselineFinding;
  readonly history: HistoryFinding;
}

export interface RendererFinding {
  readonly available: boolean;

  /**
   * Whether anything was actually tried. Defaults to `true`.
   *
   * `available` is a two-valued answer to a three-valued question — opened, would
   * not open, *not checked* — and collapsing the third into `false` is the exact
   * shape this command exists to refuse. A remote renderer is not contacted, so
   * reporting it unavailable would fail `doctor` on a machine where nothing is
   * wrong, and an operator who sees `NOT AVAILABLE` for a working endpoint stops
   * reading the rest.
   */
  readonly checked?: boolean;

  readonly because: string;
  /** Present only when a renderer was actually opened. Never reconstructed. */
  readonly identity?: RenderIdentity;
}

export interface FontFinding {
  /** `false` means no probe ran — which is not the same as "no fonts are missing". */
  readonly probed: boolean;
  readonly asserted: readonly string[];
  readonly missing: readonly string[];
  readonly because: string;
}

export interface BaselineFinding {
  readonly kind: 'ephemeral' | 'directory' | 'lfs' | 'remote';
  readonly because: string;

  /**
   * Whether a baseline in this store can be compared on this machine.
   *
   * `false` is the answer that costs an afternoon everywhere else. A tool that
   * renders in your CI and stores images somewhere shared has one failure mode
   * above all others — the machine you are on is not the machine that painted
   * the baselines — and it usually surfaces as a full-red run with no
   * explanation. It is a `readdir` here, because the store's layout *is* the
   * partition: `<root>/<identityDigest>/<subject>.png`.
   *
   * Absent when nothing was looked at: a remote store is not contacted, and an
   * ephemeral run has no baselines to be comparable with.
   */
  readonly comparable?: boolean;

  /** What the store holds, per identity, most baselines first. Absent when not scanned. */
  readonly partitions?: readonly Partition[];
}

export interface Partition {
  /** The `identityDigest` the directory is named for. */
  readonly identity: string;
  readonly baselines: number;
  /** Whether this is the identity a renderer opened here would write under. */
  readonly mine: boolean;
}

export interface HistoryFinding {
  readonly configured: boolean;
  readonly because: string;
}

export interface DoctorProbes {
  /** Opens a renderer on this machine. Rejecting is a finding, not an error. */
  renderer(): Promise<Renderer>;
  /** Whether a path exists here. Used for baseline roots; never for a URL. */
  exists(path: string): Promise<boolean>;
  /**
   * The identity directories under a baseline root, and how many images each holds.
   *
   * A probe rather than a call into `@variance-authority/store` because doctor
   * must answer for a root that is empty, absent, or holds something else
   * entirely — none of which a store can open — and because the CLI does not
   * reach into a backend's layout to ask a question the backend was not asked.
   */
  partitions(root: string): Promise<readonly { identity: string; baselines: number }[]>;
}

/**
 * Everything the config says about the renderer, in one expression.
 *
 * One expression because there are two call sites — this file and `rendererFor`
 * in `bin.ts` — and they answer the same question. They had already drifted once
 * by construction: `browser` arrived as a config field and `bin` read it while
 * this did not, which makes `doctor` launch Chromium, report *a renderer opened*,
 * and hand a green answer to an operator whose run is about to fail on a WebKit
 * that is not installed. A doctor that is wrong in the direction of "fine" is
 * worse than no doctor.
 */
export function rendererOptionsFor(config: Config): { fonts: readonly string[]; browser?: BrowserEngine } {
  return {
    fonts: config.fonts,
    ...(config.browser === undefined ? {} : { browser: config.browser }),
  };
}

/** The probes as they run for real: a browser, and the filesystem. */
export function machineProbes(config: Config): DoctorProbes {
  return {
    renderer: () => createPlaywrightRenderer(rendererOptionsFor(config)),
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    partitions: async (root) => {
      let entries: Dirent[];
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        // A root that cannot be listed is reported by `exists` in the same
        // finding. Two ways to say "there is nothing here" would let the two
        // disagree, and the one with the better sentence should win.
        return [];
      }

      return (
        await Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => ({
              identity: entry.name,
              baselines: (await orNone(join(root, entry.name))).filter((name) =>
                name.endsWith('.png'),
              ).length,
            })),
        )
      ).sort((left, right) => right.baselines - left.baselines);
    },
  };
}

async function orNone(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

export async function doctor(config: Config, probes: DoctorProbes): Promise<Diagnosis> {
  let renderer: Renderer | null = null;
  let rendererFinding: RendererFinding;

  // A remote renderer is reported, not opened. `connectRenderer` fetches the far
  // end's identity at construction, which is a network call, and this command's
  // whole position is that it makes none — the same treatment the remote
  // baseline store gets below. Reporting "available" after a probe that never
  // ran would be the failure doctor exists to prevent, pointed at itself.
  if (config.renderer !== undefined) {
    return {
      renderer: {
        available: false,
        checked: false,
        because:
          `rendering is configured at ${config.renderer.endpoint}, and deliberately not ` +
          'contacted — doctor makes no network calls, so this reports what the config says ' +
          'and not whether that machine is up. Nothing local is required, and nothing local ' +
          'was checked: the identity a baseline is partitioned by belongs to the far end',
      },
      fonts: {
        probed: false,
        asserted: config.fonts,
        missing: [],
        because:
          'the fonts that matter are the remote renderer’s, and this machine cannot measure ' +
          'them. An empty `missing` list here means no probe ran',
      },
      profile: config.profile,
      baselines: await baselines(config, probes, undefined),
      history: history(config),
    };
  }

  try {
    renderer = await probes.renderer();
    rendererFinding = {
      available: true,
      because:
        'a renderer opened on this machine; the identity below is what a durable baseline ' +
        'written here is partitioned by, and any baseline stored under a different one is ' +
        'reported incomparable rather than compared',
      identity: renderer.identity,
    };
  } catch (error) {
    rendererFinding = {
      available: false,
      because:
        `no renderer could be opened here: ${messageOf(error)}. ` +
        'Nothing can be rasterized on this machine, so no image was produced and none of ' +
        'the subjects below were observed — this is an operator problem, not a finding ' +
        'about the product.',
    };
  }

  try {
    const fonts = await probeFonts(config, renderer);
    return {
      profile: config.profile,
      renderer: rendererFinding,
      fonts,
      baselines: await baselines(config, probes, rendererFinding.identity),
      history: history(config),
    };
  } finally {
    // Closed here rather than left to the process: doctor is often the last thing
    // a CI step runs, and a leaked Chromium keeps the step alive past its work.
    if (renderer !== null) await renderer.close();
  }
}

/**
 * Ask a real renderer which of the asserted families it does not have.
 *
 * Routed through an ordinary render of a one-element document rather than a
 * special path into the renderer, so what is probed is exactly what a run would
 * probe. A separate probe API would be a second answer to the same question, and
 * the two would eventually disagree about the machine they are both standing on.
 */
async function probeFonts(config: Config, renderer: Renderer | null): Promise<FontFinding> {
  const asserted = config.fonts;

  if (renderer === null) {
    return {
      probed: false,
      asserted,
      missing: [],
      because:
        'no renderer opened, so no font was probed. An empty `missing` list here is the ' +
        'absence of a measurement, not a finding that every font is present.',
    };
  }

  if (asserted.length === 0) {
    return {
      probed: false,
      asserted,
      missing: [],
      because:
        'the config asserts no fonts, so there was nothing to probe. Every image this ' +
        'machine produces is therefore of whatever the system happened to resolve, and ' +
        'the identity digest cannot distinguish two machines that resolved differently.',
    };
  }

  try {
    const raster = await renderer.render(fontProbeDocument(asserted, config.viewport));
    return {
      probed: true,
      asserted,
      missing: raster.missingFonts,
      because:
        raster.missingFonts.length === 0
          ? `all ${asserted.length} asserted family(ies) measured as resolved`
          : `${raster.missingFonts.join(', ')} measured identically to the generic ` +
            'fallbacks, which means either that this machine lacks them or that they are ' +
            'metric-compatible substitutes — this probe cannot tell those apart',
    };
  } catch (error) {
    return {
      probed: false,
      asserted,
      missing: [],
      because: `the probe render failed (${messageOf(error)}), so no font was measured`,
    };
  }
}

/**
 * The smallest document that can carry a font assertion to a renderer.
 *
 * Exported because it is the only part of the font check that can be tested
 * without a browser, and because its one non-obvious requirement — the subject
 * root must carry `data-va-path="0"` or the renderer has nothing to clip to —
 * is exactly the kind of thing that silently breaks a diagnostic.
 */
export function fontProbeDocument(
  fonts: readonly string[],
  viewport: Viewport,
): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 'doctor:font-probe', kind: 'fixture' },
    html:
      `<div data-va-path="${SUBJECT_PATH}" style="width:200px;height:40px;font-size:16px">` +
      'variance authority font probe' +
      '</div>',
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport,
    inherited: {},
    fonts,
    diagnostics: [],
  };
}

async function baselines(
  config: Config,
  probes: DoctorProbes,
  identity: RenderIdentity | undefined,
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
      because:
        `configured at ${store.endpoint}, and deliberately not contacted — doctor makes no ` +
        'network calls, so this line reports what the config says and not whether the ' +
        'service is up',
    };
  }

  const present = await probes.exists(store.root);
  if (!present) {
    return {
      kind: store.kind,
      because:
        `${store.root} does not exist yet, so every subject will be \`new\` on the first ` +
        'run here — which is not a regression and is not a pass',
    };
  }

  const scanned = await probes.partitions(store.root);
  const stored = scanned.reduce((total, entry) => total + entry.baselines, 0);

  // An empty root is the first run, not the wrong machine, and the two produce
  // opposite advice from the same `readdir`. Nothing to compare against is why
  // every subject will be `new`; nothing *of this machine's* to compare against
  // is why every subject would be `incomparable`. Collapsing them would tell a
  // developer setting the tool up for the first time that their machine is wrong.
  if (stored === 0) {
    return {
      kind: store.kind,
      because:
        `${store.root} exists and holds no baseline yet, so every subject will be \`new\` ` +
        'on the first run here — which is not a regression and is not a pass',
    };
  }

  if (identity === undefined) {
    // No renderer opened, so there is no digest to compare against and saying
    // "incomparable" would be inventing the bad news rather than finding it.
    return {
      kind: store.kind,
      because:
        `${store.root} holds ${stored} baseline(s) across ${scanned.length} machine ` +
        'identit(ies). Which of them is this machine cannot be said, because no renderer ' +
        'opened here to be asked',
      partitions: scanned.map((entry) => ({ ...entry, mine: false })),
    };
  }

  const mine = identityDigest(identity);
  const partitions = scanned.map((entry) => ({ ...entry, mine: entry.identity === mine }));
  // TODO: a partition of pointers counts as a partition of baselines. `partitions`
  // comes from a `readdir` that opens no file, so an unsmudged store reports
  // `comparable: true` here and the run meets it one subject at a time — spec 0018
  // asks this to see it first. The first bytes of one file per partition name it.
  const ours = partitions.find((entry) => entry.mine);

  if (ours !== undefined) {
    return {
      kind: store.kind,
      comparable: true,
      because:
        `${ours.baselines} baseline(s) in ${store.root} were painted by a machine matching ` +
        `this one (${mine.slice(0, 12)}…), so a run here compares rather than reports ` +
        `\`incomparable\`${
          partitions.length > 1
            ? `. The other ${partitions.length - 1} identit(ies) in the store belong to other ` +
              'machines and are left alone'
            : ''
        }`,
      partitions,
    };
  }

  return {
    kind: store.kind,
    // The finding this command was worth writing for. Everything else here is a
    // prerequisite somebody can check by hand in a minute; this one is invisible
    // until a run goes uniformly red, and then it looks like the product broke.
    comparable: false,
    because:
      `no baseline in ${store.root} was painted by a machine like this one. This machine is ` +
      `${mine.slice(0, 12)}… and the store holds ${stored} baseline(s) under ` +
      `${scanned.length} other identit(ies), so every subject would report \`incomparable\` ` +
      'rather than compare — a full run producing no verdicts at all. Two ways out: set ' +
      '`"retention": "ephemeral"` so both images are painted here in one run and the machine ' +
      'cancels out, or point `"renderer"` at an endpoint running the identity the baselines ' +
      'were written under',
    partitions,
  };
}

function history(config: Config): HistoryFinding {
  if (config.history === undefined) {
    return {
      // The distinction `createAbsentStore` exists to protect, restated where an
      // operator reads it: nobody is keeping a record, which is a different
      // sentence from "nothing has drifted".
      configured: false,
      because:
        'no history store is configured, so nothing is being recorded. Drift questions — ' +
        'how often a component changes, what a token has moved to — cannot be answered ' +
        'from this machine, and their absence is not evidence of stability',
    };
  }

  return {
    configured: true,
    because:
      `configured at ${config.history.endpoint}, and deliberately not contacted; whether ` +
      'it accepts this project\'s writes is decided at run time, by the token',
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
