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

describe('the readers a setup file puts in its realm', () => {
  it('one Suspense reader, however many times the setup file is evaluated', async () => {
    const LINE = Symbol.for('variance-authority.story.line');
    const before = ((globalThis as { [LINE]?: unknown[] })[LINE] ?? []).length;
    vi.resetModules();
    await import('./story.js');
    vi.resetModules();
    await import('./story.js');

    expect((globalThis as { [LINE]?: unknown[] })[LINE]).toHaveLength(Math.max(before, 1));
  });
});
