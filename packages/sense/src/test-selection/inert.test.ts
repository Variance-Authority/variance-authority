// What a diff can add to a module without changing anything that already ran.

import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { coverage, testFiles } from './__fixtures__/coverage.js';
import { narrowByExecutionFromView } from './select.js';
import { bindsOnly } from './inert.js';

describe('bindsOnly', () => {
  it('is false for a function declaration, which hoists over a name the lines above it already call', () => {
    // A `function` declaration is hoisted to the top of the block it lands in
    // and binds its name *there*, over whatever that name already held. The
    // lines above it are the ones this hunk never touched, and they now call
    // the inserted function: inserting `function format(w) { ... }` into a
    // branch that already reads `return format(v);` moves that call from the
    // `format` at the top of the file to the new one, and the diff shows no
    // change on the line whose answer changed.
    //
    // The record holds that branch and the tests that entered it, so charging
    // the hunk to nobody drops every one of them into the caller's safe skip
    // list over a change they would have caught, with nothing in `unread` to
    // rescue them. The added text cannot say the name is new, because the rest
    // of the file is not in the hunk — and a name is free to be declared twice
    // in a block, and in a script at the top level, where the later
    // declaration is the one that answers.
    expect(bindsOnly('function format(w) {\n  return `local:${w}`;\n}')).toBe(false);
    expect(bindsOnly('export function decide(n) {\n  return n > 0;\n}')).toBe(false);
    expect(bindsOnly('export default function decide() {}')).toBe(false);
  });

  it('is true for a declaration that is erased before the module runs', () => {
    // An overload signature and an ambient declaration reach no emitted text,
    // so there is no name at runtime for anything already there to reach.
    expect(bindsOnly('declare function decide(n: number): boolean;')).toBe(true);
    expect(bindsOnly('function decide(n: number): boolean;')).toBe(true);
    expect(bindsOnly('declare const LIMIT: number;')).toBe(true);
    expect(bindsOnly('declare class Cart {}')).toBe(true);
  });

  it('is true for a type, an interface and a type-only import', () => {
    expect(bindsOnly('type Cart = { items: number };')).toBe(true);
    expect(bindsOnly('export interface Cart { items: number }')).toBe(true);
    expect(bindsOnly("import type { Cart } from './cart.js';")).toBe(true);
    expect(bindsOnly("export type { Cart } from './cart.js';")).toBe(true);
  });

  it('is true for an erased enum, which the module never evaluates', () => {
    expect(bindsOnly('const enum Tier { Free = compute() }')).toBe(true);
    expect(bindsOnly('declare enum Tier { Free = compute() }')).toBe(true);
  });

  it('is false for an enum block, which merges into an enum the file already declared', () => {
    // A second `enum Tier { ... }` does not bind a new name. TypeScript emits
    // every non-erased enum as `(function (Tier) { ... })(Tier || (Tier = {}))`,
    // which runs when the module does and writes its members into whichever
    // object the name already holds — declaration merging is the one legal way
    // added text at the top level reaches a name that was already there. A
    // pre-existing `Object.values(Tier)` the hunk never touched answers
    // differently afterwards.
    //
    // The record holds regions of the text before the hunk, and it charges the
    // merged block to nobody: every test that entered the module reading the
    // old enum lands in the safe skip list while its answer has moved. The
    // member initializers say nothing about this — the hazard is the emitted
    // function running at all, not what it computes.
    expect(bindsOnly("export enum Tier {\n  Enterprise = 'enterprise',\n}")).toBe(false);
    expect(bindsOnly('enum Tier { Free, Paid }')).toBe(false);
    expect(bindsOnly("enum Tier { Free = 'free', Paid = 'paid' }")).toBe(false);
    expect(bindsOnly('enum Flag { A = 1 << 0, B = 1 << 1, C = -1 }')).toBe(false);
  });

  it('is false for an enum whose member runs something, which the emitted function calls at load', () => {
    expect(bindsOnly('enum Tier { Free = register() }')).toBe(false);
    expect(bindsOnly('export enum Tier { Free = limits.free }')).toBe(false);
    expect(bindsOnly('enum Tier { Free = `${prefix}-free` }')).toBe(false);
  });

  it('is false for comments and blank lines, which say nothing about where they landed', () => {
    // Everything this answers true for is legal only at statement position, so
    // reading one out of the fragment is reading that the gap the hunk opened
    // is code. Text that parses to no construct at all carries no such reading:
    // the same bytes on the same line are a comment between two statements, a
    // line of the CSS a styled component renders out of a template literal, and
    // a line of the copy a JSX text node paints. A diff has no coordinate finer
    // than the line, so nothing here separates them, and the one that renders
    // is the one a tool that compares pixels exists to catch.
    expect(bindsOnly('')).toBe(false);
    expect(bindsOnly('\n\n')).toBe(false);
    expect(bindsOnly('// reviewed\n/* and again */')).toBe(false);
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

  it('is false for a re-export that carries a source, which is an import edge', () => {
    // Same shape as `export { encode };` — value kind, null declaration — but
    // the barrel now evaluates the module it names.
    expect(bindsOnly("export { encode } from './wire.js';")).toBe(false);
    expect(bindsOnly("export { default } from './wire.js';")).toBe(false);
    expect(bindsOnly("export { a, b } from './wire.js';")).toBe(false);
    expect(bindsOnly("export { encode as e } from './wire.js';")).toBe(false);
    expect(bindsOnly("export { type T, value } from './wire.js';")).toBe(false);
    // An empty clause still names the module, and so does a clause of inline
    // `type` specifiers under `verbatimModuleSyntax`; the diff does not say
    // which compiler option applies.
    expect(bindsOnly("export {} from './wire.js';")).toBe(false);
    expect(bindsOnly("export { type T } from './wire.js';")).toBe(false);
  });

  it('is true for a re-export of a local name, which adds no edge', () => {
    expect(bindsOnly('export { encode };')).toBe(true);
    expect(bindsOnly('export { type T };')).toBe(true);
  });

  it('is false for a fragment, which is most of what an insertion inside a body looks like', () => {
    // The text has no meaning on its own, so nothing about it can be ruled out.
    expect(bindsOnly('  } else {')).toBe(false);
    expect(bindsOnly('  sum += item.price;')).toBe(false);
  });
});

describe('what an inert hunk removes from a selection', () => {
  // `src/decide.ts` has a branch on lines 3 to 5 that alpha alone took, inside a
  // module every one of alpha's and beta's runs evaluated. An insertion after
  // line 4 opens a gap in that branch's interior.
  const inserted = (text: string): string => `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,0 +5 @@
+${text}`;
  const answer = (diff: string): ReturnType<typeof narrowByExecutionFromView> =>
    narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff);

  it('charges the region a blank line landed in, which the diff cannot place', () => {
    // A blank line inside a branch is nothing; a blank line inside the template
    // literal a styled component renders from is a line of stylesheet, and the
    // recording holds line numbers, not what the line is made of. Charging it to
    // nobody puts every subject of the component in the caller's skip list over
    // rendered CSS that moved.
    expect(answer(inserted('')).entered).toEqual(['test/alpha.test.ts']);
    expect(answer(inserted('  /* brand refresh */')).entered).toEqual(['test/alpha.test.ts']);
  });

  it('still charges nobody for a declaration the module never runs', () => {
    // The narrowing this exists for, and the whole of what it still covers: the
    // type is erased before the module loads, so the text that was already there
    // is the whole of what ran.
    expect(answer(inserted('type Tone = "warn";')).entered).toEqual([]);
    expect(answer(inserted('type Tone = "warn";')).whole).toEqual(testFiles);
  });
});
