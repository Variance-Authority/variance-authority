/**
 * Opening a renderer, which is wiring rather than a command.
 *
 * Split out of `dispatch.ts` when that file crossed the size gate. The seam is
 * the same one that put the flag table in `parse.ts`: everything else in the
 * dispatcher is *which command runs*, and this is *what a run is handed* — read
 * by whoever is adding a renderer, not by whoever is adding a command. It is
 * also the only part of that file the library half exports for its own sake.
 */

import type { Renderer } from '@variance-authority/raster';
import { messageOf } from './config-values.js';
import type { Config } from './config.js';
import { OperatorError } from './exit.js';
import { rendererOptionsFor } from './commands/doctor.js';

/**
 * The renderer the config asks for, imported lazily.
 *
 * `import()` rather than a top-level import so that `report`, `accept`, and
 * `serve` — none of which may render — do not load a browser driver in order to
 * read a file. The failure it produces when there is no browser is an operator
 * error with the underlying message intact, which is what makes `run --profile
 * chromium` on a machine without Chromium exit 2 rather than 1.
 *
 * **Exported because the library half needs it (ADR-0024).** `deps.renderer` has
 * to be filled in by whoever composes a run, and this package's own README filled
 * it in with `createPlaywrightRenderer` from `@variance-authority/playwright` —
 * so the documented way to use the CLI as a library required knowing about the
 * browser package, which is the reach-through that ADR forbids. That example was
 * also wrong by then: it ignored `browser` and `renderer`, handing back a local
 * Chromium whatever the config said. One function answers both.
 */
export async function rendererFor(config: Config): Promise<Renderer> {
  // Somewhere else, if the config says so. Nothing downstream can tell: a remote
  // renderer satisfies the same contract, answers `identityFor` by the same
  // derivation, and is guarded by the same comparability check — which is what
  // makes the offload a wiring decision rather than a second pipeline.
  if (config.renderer !== undefined) {
    const { connectRenderer } = await import('@variance-authority/remote');
    const remote = config.renderer;
    return openRenderer(() =>
      connectRenderer({
        endpoint: remote.endpoint,
        ...(remote.timeoutMs === undefined ? {} : { timeoutMs: remote.timeoutMs }),
      }),
    );
  }

  const { createPlaywrightRenderer } = await import('@variance-authority/playwright');
  // The same expression `doctor` probes with. Two spellings of "what the config
  // says about the renderer" is how a green doctor and a failing run stop being
  // about the same machine.
  return openRenderer(() => createPlaywrightRenderer(rendererOptionsFor(config)));
}

/**
 * Any failure to open a renderer is an operator error, never a verdict.
 *
 * Exported, and taking the opener as an argument, for one reason: ADR-0017
 * requires `run --profile chromium` on a machine without Chromium to
 * exit 2 rather than 1, and until 2026-08-03 that was argued in a comment and
 * asserted by nothing — the only criterion in the spec still carried by prose.
 * It cannot be tested through `main` on a machine that *has* a browser, and
 * uninstalling one to check is not a test.
 *
 * The distinction is the whole of why exit 2 exists. Exit 1 means a component
 * changed and somebody should look; exit 2 means the run never happened. A
 * missing browser reported as 1 sends a reviewer to find a change nobody made,
 * and — worse — a CI step that treats 1 as "accept and move on" would record
 * baselines from a run that observed nothing.
 */
export async function openRenderer(open: () => Promise<Renderer>): Promise<Renderer> {
  try {
    return await open();
  } catch (error) {
    throw new OperatorError(
      `no renderer could be opened on this machine: ${messageOf(error)}. ` +
        'Run `variance doctor` for what this machine can observe.',
      { cause: error },
    );
  }
}
