import type { CutModules, Tool } from './tool.js';

// compass: variance-authority.report.agent-surface

/**
 * The modules one call asked to have cut, read from the checkout under `root`.
 *
 * The host's half of {@link Tool.cuts}, in one place because two hosts ask the
 * same tools: the server over the wire and `variance ask` from a shell. Each
 * module is cut by the join a recorded run is read with, so a file whose text
 * moved on since its build comes back not instrumented and a file that is gone
 * does not come back. Nothing is read for a call that names no region, and the
 * parser is loaded only by the first call that does.
 *
 * `undefined` where the tool names no region or the host names no checkout.
 */
export async function cutFor<Subject>(
  tool: Pick<Tool<Subject>, 'cuts'> | undefined,
  subject: Subject,
  input: Readonly<Record<string, unknown>>,
  root: string | undefined,
): Promise<CutModules | undefined> {
  if (tool?.cuts === undefined || root === undefined) return undefined;
  const asked = tool.cuts(subject, input);
  if (asked.size === 0) return new Map();

  const [{ deriveModules }, { instrumentModeOf }] = await Promise.all([
    import('@variance-authority/sense/test-selection'),
    import('@variance-authority/sense/instrument'),
  ]);
  const cut = new Map<string, Awaited<ReturnType<typeof deriveModules>>>();
  for (const [instrumentation, ids] of asked) {
    const mode = instrumentModeOf(instrumentation);
    // Probes this build does not emit numbered regions it cannot number again.
    if (mode !== undefined) cut.set(instrumentation, await deriveModules(root, ids, mode));
  }
  return cut;
}
