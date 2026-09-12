// What a diff can add to a module without changing anything that already ran.

import { describe, expect, it } from 'vitest';
import { bindsOnly } from './inert.js';

describe('bindsOnly', () => {
  it('is true for a declaration that binds a name and runs nothing', () => {
    expect(bindsOnly('export function decide(n) {\n  return n > 0;\n}')).toBe(true);
    expect(bindsOnly('function decide(n) {\n  return n > 0;\n}')).toBe(true);
    expect(bindsOnly('export default function decide() {}')).toBe(true);
  });

  it('is true for a type, an interface, an enum and a type-only import', () => {
    expect(bindsOnly('type Cart = { items: number };')).toBe(true);
    expect(bindsOnly('export interface Cart { items: number }')).toBe(true);
    expect(bindsOnly('enum Tier { Free, Paid }')).toBe(true);
    expect(bindsOnly("import type { Cart } from './cart.js';")).toBe(true);
    expect(bindsOnly("export type { Cart } from './cart.js';")).toBe(true);
  });

  it('is true for comments and blank lines, which the parser reads as no statements', () => {
    expect(bindsOnly('')).toBe(true);
    expect(bindsOnly('\n\n')).toBe(true);
    expect(bindsOnly('// reviewed\n/* and again */')).toBe(true);
  });

  it('is false for a class, whose decorators, keys, initializers and base all run', () => {
    expect(bindsOnly('class Cart extends base() {}')).toBe(false);
    expect(bindsOnly('class Cart { static items = compute(); }')).toBe(false);
  });

  it('is false for anything that evaluates while the module does', () => {
    expect(bindsOnly('const scale = compute();')).toBe(false);
    expect(bindsOnly("import './register.js';")).toBe(false);
    expect(bindsOnly('register();')).toBe(false);
    expect(bindsOnly('namespace Cart { register(); }')).toBe(false);
  });

  it('is false for a fragment, which is most of what an insertion inside a body looks like', () => {
    // The text has no meaning on its own, so nothing about it can be ruled out.
    expect(bindsOnly('  } else {')).toBe(false);
    expect(bindsOnly('  sum += item.price;')).toBe(false);
  });
});
