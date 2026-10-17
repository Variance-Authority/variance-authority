import { describe, expect, it } from 'vitest';
import type { Use } from '@variance-authority/package/help';
import { type Members, routes } from './members.js';

/**
 * The checker a member answer sends the reader to is the declaration's own.
 *
 * Which type a value has is the type checker's of the language the declaration
 * is written in, so the line under the uses names TypeScript's language service
 * for a JavaScript or TypeScript declaration and that language's own language
 * server for any other. Main reads member declarations from JavaScript and
 * TypeScript alone, so the other languages are pinned here, on `routes`.
 */

const declared = (at: string, by = 'Props'): Use => ({ at, line: 3, by, kind: 'property', type: false });
const named = (...sites: readonly Use[]): Members => ({
  declared: sites,
  used: sites.map((site) => ({ declared: site, uses: [] })),
});

describe('the checker a member answer names is the declaration language’s', () => {
  for (const at of ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) {
    it(`names TypeScript's language service for a declaration in ${at}`, () => {
      expect(routes('size', named(declared(`src/${at}`))).at(-1)).toBe(
        `Ask TypeScript for those: its language service's find-references on \`Props.size\` at src/${at}:3.`,
      );
    });
  }

  it('names the language server of a declaration in another language, and never TypeScript', () => {
    const line = routes('size', named(declared('src/shapes.py'))).at(-1);
    expect(line).toBe(
      "Ask the declaration's own language for those: its language server's find-references on `Props.size` at src/shapes.py:3.",
    );
    expect(line).not.toContain('TypeScript');
  });

  it('names a language server for a declaration in a file no reader claims', () => {
    expect(routes('size', named(declared('src/Shapes.scala'))).at(-1)).not.toContain('TypeScript');
  });

  it('names TypeScript for several declarations all in JavaScript or TypeScript', () => {
    expect(routes('size', named(declared('src/a.ts'), declared('src/b.jsx', 'Other'))).at(-1)).toBe(
      "Ask TypeScript for those: its language service's find-references on the declaration you mean, each listed above with its file and line (`package` narrows the declarations to one package).",
    );
  });

  it("names each declaration's own type checker for several declarations in different languages", () => {
    expect(routes('size', named(declared('src/a.ts'), declared('src/shapes.rs', 'Shape'))).at(-1)).toBe(
      "Ask the declaration's own language's type checker for those: its find-references on the declaration you mean, each listed above with its file and line (`package` narrows the declarations to one package).",
    );
  });

  it('names the language server for several declarations all in one other language', () => {
    expect(routes('size', named(declared('src/a.py'), declared('src/b.py', 'Other'))).at(-1)).toBe(
      "Ask the declaration's own language for those: its language server's find-references on the declaration you mean, each listed above with its file and line (`package` narrows the declarations to one package).",
    );
  });
});
