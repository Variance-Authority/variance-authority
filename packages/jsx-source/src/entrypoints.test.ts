import { describe, expect, it } from 'vitest';

/**
 * Both entrypoints exist and both are importable.
 *
 * `jsxImportSource` is one setting for two runtimes. A project points it here
 * and every development build resolves `/jsx-dev-runtime`; every build with the
 * development transform off resolves `/jsx-runtime` — and if that file is
 * missing or throws on import, the failure arrives as a resolution error in
 * somebody's production build, from a package they configured once and stopped
 * thinking about.
 *
 * This asserts what it says and no more. The production entrypoint records
 * nothing, because the production transform computes no location to record;
 * that it re-exports React unchanged is the whole contract.
 */

describe('the entrypoint a production transform resolves', () => {
  it('re-exports React s runtime unchanged', async () => {
    const ours = await import('./jsx-runtime.js');
    const react = await import('react/jsx-runtime');

    expect(ours.jsx).toBe(react.jsx);
    expect(ours.jsxs).toBe(react.jsxs);
    expect(ours.Fragment).toBe(react.Fragment);
  });
});

describe('the entrypoint a development transform resolves', () => {
  it('exports a recording runtime of its own', async () => {
    const ours = await import('./jsx-dev-runtime.js');
    const react = await import('react/jsx-dev-runtime');

    expect(typeof ours.jsxDEV).toBe('function');
    expect(ours.jsxDEV).not.toBe(react.jsxDEV);
    expect(ours.Fragment).toBe(react.Fragment);
  });
});
