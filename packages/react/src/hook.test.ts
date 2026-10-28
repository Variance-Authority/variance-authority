// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { reactHasMounted } from './hook.js';

describe('asking whether React has mounted', () => {
  it('answers no in a scope with no document', () => {
    expect(reactHasMounted({})).toBe(false);
  });
});
