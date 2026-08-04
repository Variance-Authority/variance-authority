import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

/**
 * The remote renderer field, and the one combination it refuses.
 *
 * This is the field that makes the offload a product rather than a library
 * capability, so the rules around it are the ones an operator meets first.
 */

const BASE = {
  project: 'acme',
  profile: 'chromium',
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
  retention: 'ephemeral',
  subjects: { kind: 'list', ids: ['a'], collector: 'c.mjs' },
  fonts: [],
  report: 'run.json',
};

const OPTIONS = { baseDir: '/tmp', file: 'variance.config.json' };

describe('the renderer field', () => {
  it('takes an endpoint', () => {
    const config = parseConfig({ ...BASE, renderer: { endpoint: 'http://box:7777' } }, OPTIONS);
    expect(config.renderer?.endpoint).toBe('http://box:7777');
  });

  it('takes a timeout, because a render that hangs must fail rather than stall', () => {
    const config = parseConfig(
      { ...BASE, renderer: { endpoint: 'http://box:7777', timeoutMs: 5000 } },
      OPTIONS,
    );
    expect(config.renderer?.timeoutMs).toBe(5000);
  });

  it('refuses a timeout of zero, which reads like a disabled renderer', () => {
    expect(() =>
      parseConfig({ ...BASE, renderer: { endpoint: 'http://box:7777', timeoutMs: 0 } }, OPTIONS),
    ).toThrow(/timeoutMs/);
  });

  it('refuses a token, because nothing transmits one', () => {
    // `serveRenderer` has no authentication. A field that accepted a credential
    // nobody sends would read as the endpoint being protected, and it is not —
    // so the refusal is the honest surface, not an omission.
    expect(() =>
      parseConfig({ ...BASE, renderer: { endpoint: 'http://box:7777', token: 'x' } }, OPTIONS),
    ).toThrow(/token/);
  });

  it('refuses `browser` alongside it, rather than picking one', () => {
    // The failure this prevents: an operator reads `"browser": "webkit"` in their
    // own config, believes they are testing WebKit, and every pixel was painted
    // by whatever engine happens to run on a machine they do not own.
    expect(() =>
      parseConfig({ ...BASE, browser: 'webkit', renderer: { endpoint: 'http://box:7777' } }, OPTIONS),
    ).toThrow(/browser.*renderer/s);
  });
});
