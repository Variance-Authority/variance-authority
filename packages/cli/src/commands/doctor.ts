import { access } from 'node:fs/promises';
import type {
  ProfileId,
  RenderDocument,
  RenderIdentity,
  Viewport,
} from '@variance-authority/core';
import { SUBJECT_PATH, createPlaywrightRenderer, type Renderer } from '@variance-authority/raster';
import type { Config } from '../config.js';
import { EXIT_CLEAN, EXIT_OPERATOR, type ExitCode } from '../exit.js';

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
}

/** The probes as they run for real: a browser, and the filesystem. */
export function machineProbes(config: Config): DoctorProbes {
  return {
    renderer: () => createPlaywrightRenderer({ fonts: config.fonts }),
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export async function doctor(config: Config, probes: DoctorProbes): Promise<Diagnosis> {
  let renderer: Renderer | null = null;
  let rendererFinding: RendererFinding;

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
      baselines: await baselines(config, probes),
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

async function baselines(config: Config, probes: DoctorProbes): Promise<BaselineFinding> {
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
  return {
    kind: store.kind,
    because: present
      ? `${store.root} exists on this machine; whether it holds a baseline for this ` +
        "renderer's identity is a question only a run can answer"
      : `${store.root} does not exist yet, so every subject will be \`new\` on the first ` +
        'run here — which is not a regression and is not a pass',
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

/**
 * Doctor's exit code.
 *
 * `2` for exactly one condition: no renderer. That is the state in which a run
 * cannot happen at all, which is what code `2` means.
 *
 * Missing fonts deliberately do *not* move it. See this file's header: the probe
 * cannot distinguish an absent family from a metric-compatible substitute, and a
 * diagnostic that fails a build on a false positive is a diagnostic somebody
 * deletes. They are printed at the top of the output instead, where a person
 * decides.
 */
export function exitForDiagnosis(diagnosis: Diagnosis): ExitCode {
  return diagnosis.renderer.available ? EXIT_CLEAN : EXIT_OPERATOR;
}

export function formatDiagnosis(diagnosis: Diagnosis): string {
  const identity = diagnosis.renderer.identity;

  return [
    `profile: ${diagnosis.profile}`,
    '',
    `renderer: ${diagnosis.renderer.available ? 'available' : 'NOT AVAILABLE'}`,
    `  ${diagnosis.renderer.because}`,
    ...(identity !== undefined
      ? [
          `  identity: ${identity.renderer} (${identity.engine}, ${identity.platform}, ` +
            `${identity.deviceScaleFactor}x)`,
          `  fonts asserted into the identity: ${
            identity.fonts.length === 0 ? 'none' : identity.fonts.join(', ')
          }`,
        ]
      : []),
    '',
    `fonts: ${fontHeadline(diagnosis.fonts)}`,
    `  ${diagnosis.fonts.because}`,
    ...(diagnosis.fonts.probed
      ? [
          '  known limit: a family that is metric-compatible with a generic — Arimo, ' +
            'Liberation Sans, the substitutes a container ships so layout does not move —',
          '  is reported missing by this probe. It reports a doubt rather than swallowing ' +
            'one, and does not change the exit code.',
        ]
      : []),
    '',
    `baselines: ${diagnosis.baselines.kind}`,
    `  ${diagnosis.baselines.because}`,
    '',
    `history: ${diagnosis.history.configured ? 'configured' : 'none'}`,
    `  ${diagnosis.history.because}`,
  ].join('\n');
}

function fontHeadline(finding: FontFinding): string {
  if (!finding.probed) return 'not probed';
  return finding.missing.length === 0
    ? `${finding.asserted.length} asserted, none reported missing`
    : `${finding.missing.length} of ${finding.asserted.length} reported missing`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
