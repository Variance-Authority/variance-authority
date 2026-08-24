import { describe, expect, it } from 'vitest';
import type { Observation } from '@variance-authority/observe';
import {
  AGENT,
  AGENT_VERSION,
  bundlePageAgent,
} from '@variance-authority/playwright-test';
import * as surface from './index.js';

function observation(verdict: Observation['verdict']): Observation {
  return {
    subject: 'cart/empty',
    verdict,
    because: verdict === 'unchanged' ? 'same document digest' : 'no baseline',
    regions: [],
    rendered: verdict !== 'unchanged',
    missingFonts: [],
  };
}

describe('the Playwright integration is additive', () => {
  it('does not export replacements for the runner-owned test and expect', () => {
    expect(surface).not.toHaveProperty('test');
    expect(surface).not.toHaveProperty('expect');
  });

  it('exports direct and composable entry points instead', () => {
    expect(surface.observe).toBeTypeOf('function');
    expect(surface.createVariance).toBeTypeOf('function');
    expect(surface.varianceFixtures).toBeTypeOf('object');
    expect(surface.varianceMatchers).toBeTypeOf('object');
  });

  it('asserts through a helper without taking ownership of expect', () => {
    expect(() => surface.assertUnchanged(observation('unchanged'))).not.toThrow();
    expect(() => surface.assertUnchanged(observation('new'))).toThrow(
      'cart/empty: new — no baseline',
    );
  });

  it('publishes the page-agent identity and a bundle that installs it', async () => {
    expect(AGENT).toBe('__variance_authority_playwright_test__');
    expect(AGENT_VERSION).toBe('playwright-test@0');

    const bundle = await bundlePageAgent();
    expect(bundle).toContain(JSON.stringify(AGENT));
    expect(bundle).toContain(JSON.stringify(AGENT_VERSION));
  });
});
