import { describe, expect, it } from 'vitest';
import { instrumentationId, probeRecipe, probeRuntime } from './index.js';

describe('the header is written by the crate a Rust pipeline links', () => {
  it('names the instrumentation it belongs to, and takes its probes from the root', () => {
    // A transformer that places the probes itself declares this recipe, and the
    // Jest wrapper refuses one that is not its own.
    expect([probeRecipe('presence'), probeRecipe('entries')].map((recipe) => recipe.split('+')[0])).toEqual([
      instrumentationId('presence'),
      instrumentationId('entries'),
    ]);
    expect(probeRuntime('', 0)).toContain('globalThis.__VA__.r("",0)');
  });
});
