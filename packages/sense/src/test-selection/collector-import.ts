/** The specifier the probes' build resolves to the execution collector. */
export const VIRTUAL_COLLECTOR = 'variance-authority:execution-collector';

/** What every module the Vite plugin probes ends with: an import, hoisted, so the collector loads ahead of its probes. */
export const COLLECTOR_IMPORT = `\n;import ${JSON.stringify(VIRTUAL_COLLECTOR)};`;

/**
 * A probed module as a realm with no bundler runs it: without the collector
 * import, which only the probes' build resolves, so the realm supplies the
 * collector itself or already has one.
 *
 * Alone in its module, and importing nothing, because what calls it stands in
 * for a build — a test, a fixture, a service with no bundler — and loads it
 * from source or from the built package, beside the build it stands in for.
 */
export function withoutCollectorImport(code: string): string {
  if (!code.endsWith(COLLECTOR_IMPORT)) throw new Error('the module does not end with the collector import the Vite plugin appends to a module it probes');
  return code.slice(0, -COLLECTOR_IMPORT.length);
}
