// The setup file in a realm with a page and no story listening: it taps no
// commit, and puts one Suspense watch on the page however often it runs.

import { describe, expect, it, vi } from 'vitest';

describe('the watch a setup file puts on its page', () => {
  it('one Suspense watch, however many times the setup file is evaluated', async () => {
    const SUSPENSE = Symbol.for('variance-authority.react.story.suspense');
    const HOOK = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
    const realm = globalThis as { [SUSPENSE]?: unknown; document?: unknown; [HOOK]?: unknown };
    realm.document = { nodeType: 9 };
    // A watch wraps React's commit announcement; each wrap is one write to it.
    let wraps = 0;
    realm[HOOK] = {
      set onCommitFiberRoot(_: unknown) {
        wraps += 1;
      },
      get onCommitFiberRoot(): undefined {
        return undefined;
      },
    };
    try {
      vi.resetModules();
      await import('./story.js');
      vi.resetModules();
      await import('./story.js');
      expect(wraps).toBe(1);
    } finally {
      delete realm.document;
      delete realm[HOOK];
      delete realm[SUSPENSE];
    }
  });
});
