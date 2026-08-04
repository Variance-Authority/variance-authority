import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL, ROOT, type Manifest } from './workspaces.js';

/**
 * Build tools are not product.
 *
 * Nothing here ships today — every package is `private: true` — but the question
 * a reader asks about a visual-regression tool is *what does adopting it drag
 * in*, and the honest answer has to be enforced rather than currently true. A
 * compiler, a linter or a test runner in a package's `dependencies` is a
 * consumer's install, not this repository's.
 *
 * `typescript` is the one worth naming. A reader who saw it in a manifest would
 * reasonably conclude the product parses their TypeScript. It does not — it
 * reads a rendered document — and since 2026-08-04 nothing in this repository
 * imports the compiler API at all.
 */
describe('no package ships a build tool', () => {
  const TOOLING = ['typescript', 'tsgo', 'oxlint', 'vitest', 'esbuild', 'prettier', 'eslint'];

  it.each(ALL.map((workspace) => [workspace.name, workspace] as const))(
    '%s keeps its tooling out of `dependencies`',
    (_name, workspace) => {
      const shipped = Object.keys(workspace.manifest.dependencies ?? {}).filter((dependency) =>
        TOOLING.includes(dependency),
      );

      expect(shipped).toEqual([]);
    },
  );

  it('finds the tools it is checking for, so it cannot pass by naming nothing', () => {
    // The rule is worthless if every name in it is a typo. At least one has to
    // be a real devDependency somewhere, or this passes over a list of ghosts.
    const anywhere = new Set(
      ALL.flatMap((workspace) => Object.keys(workspace.manifest.devDependencies ?? {})).concat(
        Object.keys(
          (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest)
            .devDependencies ?? {},
        ),
      ),
    );

    expect(TOOLING.filter((tool) => anywhere.has(tool)).length).toBeGreaterThan(0);
  });
});

/**
 * Two shapes that were allowed to grow until somebody read one.
 *
 * **Length.** A file nobody will read is a file nobody will correct, and
 * `documentation.test.ts` reached 973 lines before anyone did. The limit is
 * arbitrary and that is the point: an arbitrary limit gets enforced, a
 * judgement-based one gets argued with. Existing violations are listed rather
 * than exempted by pattern, so the list can only be shortened.
 *
 * **A compiler in a test.** The same file drove `ts.createProgram` over a
 * virtual filesystem to typecheck README fences. Every part of that was avoidable
 * — the examples are now real files and `tsc --build` compiles them — and while
 * it existed the repository could not move to TypeScript 7, because 7 ships no
 * compiler API. A test that needs a compiler is a build step that has been
 * filed in the wrong place.
 */
describe('nothing grows into a monster', () => {
  const SOURCE = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.mjs', '*.js', '*.jsx'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');

  const LIMIT = 500;

  /**
   * Files over the limit, and there are none.
   *
   * This was a list of twenty-two on the day the rule landed — a debt list
   * rather than an exemption list, on the argument that a file may leave it and
   * may not join it. It emptied on 2026-08-04, which is the only outcome that
   * makes the argument true rather than merely stated.
   *
   * Kept as an empty set rather than deleted along with the tests below,
   * because the next long file will want somewhere to go, and re-deriving the
   * rules for it — a name, not a pattern; leaving is allowed, joining is not —
   * is how an exemption list gets born instead.
   */
  const OVERSIZE = new Set<string>([]);

  const lines = (file: string): number => readFileSync(join(ROOT, file), 'utf8').split('\n').length;

  it.each(SOURCE.filter((file) => !OVERSIZE.has(file)))(`%s is under ${LIMIT} lines`, (file) => {
    expect(lines(file)).toBeLessThanOrEqual(LIMIT);
  });

  it('has no entry on the debt list that is already under the limit', () => {
    // The list shortens by deleting a name once the file is split, and this is
    // what makes anyone bother: a fixed file that stays listed fails here.
    const fixed = [...OVERSIZE].filter((file) => existsSync(join(ROOT, file)) && lines(file) <= LIMIT);
    expect(fixed).toEqual([]);
  });

  it('has no entry on the debt list that no longer exists', () => {
    expect([...OVERSIZE].filter((file) => !existsSync(join(ROOT, file)))).toEqual([]);
  });

  it.each(SOURCE.filter((file) => /\.(test|spec|check)\.(ts|tsx)$/.test(file)))(
    '%s does not drive a compiler',
    (file) => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);

      expect(
        imports.filter((specifier) => /^(typescript|typescript-compiler-api|@swc|esbuild)/.test(specifier)),
      ).toEqual([]);
    },
  );
});
