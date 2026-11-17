import { createContext, createElement, forwardRef, memo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { reactKind } from './story.js';

describe('what a story calls a React object', () => {
  it('the kind React marks it with', () => {
    const Theme = createContext('light');
    const Panel = (): null => null;

    expect(reactKind(Theme)).toBe('react.context');
    expect(reactKind(memo(Panel))).toBe('react.memo');
    expect(reactKind(forwardRef(Panel))).toBe('react.forward_ref');
    expect(reactKind(createElement(Panel))).toBe('react.transitional.element');
  });

  it('nothing for an object React did not mark', () => {
    expect(reactKind({})).toBeUndefined();
    expect(reactKind({ $$typeof: Symbol.for('other.kind') })).toBeUndefined();
    expect(reactKind(() => null)).toBeUndefined();
  });
});

describe('the watch a setup file puts on its page', () => {
  it('one Suspense watch, however many times the setup file is evaluated', async () => {
    const SUSPENSE = Symbol.for('variance-authority.react.story.suspense');
    const realm = globalThis as { [SUSPENSE]?: unknown; document?: unknown };
    const stops: unknown[] = [];
    realm.document = { nodeType: 9 };
    const Watch = class {
      observe(): void {}
      disconnect(): void {}
    };
    vi.stubGlobal('MutationObserver', class extends Watch {
      constructor() {
        super();
        stops.push(this);
      }
    });
    try {
      vi.resetModules();
      await import('./story.js');
      vi.resetModules();
      await import('./story.js');
      expect(stops).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      delete realm.document;
      delete realm[SUSPENSE];
    }
  });
});
