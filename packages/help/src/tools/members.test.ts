import { describe, expect, it } from 'vitest';
import type { Use } from '@variance-authority/package/help';
import { type Members, membersStop, routes } from './members.js';
import { spellingOf } from '@variance-authority/mcp/tools';

/**
 * The checker a member answer sends the reader to is the declaration's own.
 *
 * Which type a value has is the type checker's of the language the declaration
 * is written in, so the line under the uses names TypeScript's language service
 * for a JavaScript or TypeScript declaration and that language's own language
 * server for any other. Main reads member declarations from JavaScript and
 * TypeScript alone, so the other languages are pinned here, on `routes`.
 */

/** The answers asked over the wire, as these were before a shell spelled them. */
const WIRE = spellingOf(undefined);

const declared = (at: string, by = 'Props'): Use => ({ at, line: 3, by, kind: 'property', type: false });
const named = (...sites: readonly Use[]): Members => ({
  member: 'size',
  declared: sites,
  used: sites.map((site) => ({ declared: site, uses: [] })),
});

describe('the checker a member answer names is the declaration language’s', () => {
  for (const at of ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) {
    it(`names TypeScript's language service for a declaration in ${at}`, () => {
      expect(routes(named(declared(`src/${at}`)), WIRE).at(-1)).toBe(
        `Ask TypeScript for those: its language service's find-references on \`Props.size\` at src/${at}:3.`,
      );
    });
  }

  it('names the language server of a declaration in another language, and never TypeScript', () => {
    const line = routes(named(declared('src/shapes.py')), WIRE).at(-1);
    expect(line).toBe(
      "Ask the declaration's own language for those: its language server's find-references on `Props.size` at src/shapes.py:3.",
    );
    expect(line).not.toContain('TypeScript');
  });

  it('names a language server for a declaration in a file no reader claims', () => {
    expect(routes(named(declared('src/Shapes.scala')), WIRE).at(-1)).not.toContain('TypeScript');
  });

  it('names TypeScript for several declarations all in JavaScript or TypeScript', () => {
    expect(routes(named(declared('src/a.ts'), declared('src/b.jsx', 'Other')), WIRE).at(-1)).toBe(
      "Ask TypeScript for those: its language service's find-references on the declaration you mean, each listed above with its file and line (`package` narrows the declarations to one package).",
    );
  });

  it("names each declaration's own type checker for several declarations in different languages", () => {
    expect(routes(named(declared('src/a.ts'), declared('src/shapes.rs', 'Shape')), WIRE).at(-1)).toBe(
      "Ask the declaration's own language's type checker for those: its find-references on the declaration you mean, each listed above with its file and line (`package` narrows the declarations to one package).",
    );
  });

  it('names the language server for several declarations all in one other language', () => {
    expect(routes(named(declared('src/a.py'), declared('src/b.py', 'Other')), WIRE).at(-1)).toBe(
      "Ask the declaration's own language for those: its language server's find-references on the declaration you mean, each listed above with its file and line (`package` narrows the declarations to one package).",
    );
  });
});

describe('a member answer says which languages its members were not read from', () => {
  const stop = (elsewhere: readonly string[] | undefined, ...sites: readonly Use[]): string | undefined =>
    membersStop({ ...named(...sites), ...(elsewhere === undefined ? {} : { elsewhere }) });

  it('says nothing where every file is read for members, or the declarations were not read', () => {
    expect(stop([], declared('src/a.ts'))).toBeUndefined();
    expect(stop(undefined)).toBeUndefined();
  });

  it('names every language the index holds whose members were not read, in one sentence', () => {
    expect(stop(['Java', 'Kotlin', 'Swift'])).toBe(
      "Members are read from JavaScript and TypeScript files only, and this workspace's Java, Kotlin and Swift files were not read for them: " +
        "if `size` is a member there, ask their language server's workspace symbols for it, then its find-references on the declaration.",
    );
  });

  it('says the member may be declared there too, beside the declarations it lists', () => {
    expect(stop(['Rust'], declared('src/a.ts'))).toContain("this workspace's Rust files were not read for them: if `size` is a member there too,");
  });

  it('ends the member answer with it, after the line that names the checker', () => {
    expect(routes({ ...named(declared('src/a.ts')), elsewhere: ['Python'] }, WIRE).at(-1)).toBe(stop(['Python'], declared('src/a.ts')));
  });
});
