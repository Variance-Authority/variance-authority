import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL, PACKAGES, ROOT, type Manifest } from './workspaces.js';

/**
 * Build tools are not product.
 *
 * Every package here is publishable — MIT, versioned, one pushed tag from a
 * registry — so the question a reader asks about a visual-regression tool,
 * *what does adopting it drag in*, now has a consequence rather than a
 * hypothetical answer. A compiler, a linter or a test runner in a package's
 * `dependencies` is a consumer's install, not this repository's.
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
 * A package that declares a licence carries its text.
 *
 * npm packs each package from its own directory, so a LICENSE at the repository
 * root reaches no tarball. Every `packages/*` manifest says `"license": "MIT"`,
 * and MIT is the clause that requires the notice to travel with the copy — so a
 * package declaring it and shipping without it is the one licence failure this
 * layout produces by default rather than by mistake.
 *
 * The text is compared to the root's, because a per-directory copy is a file
 * that can drift, and a licence that differs between packages is worse than the
 * problem the copies solve. `examples/` and `cases/` are excluded by taking
 * `PACKAGES`: they are `private: true` subjects, and nothing publishes them.
 */
describe('every published package carries the licence it claims', () => {
  const ROOT_LICENSE = readFileSync(join(ROOT, 'LICENSE'), 'utf8');

  it('reads a root licence, so this cannot pass by comparing nothing', () => {
    expect(ROOT_LICENSE).toContain('MIT License');
  });

  it.each(PACKAGES.map((workspace) => [workspace.name, workspace] as const))(
    '%s ships LICENSE, matching the root',
    (_name, workspace) => {
      const path = join(workspace.dir, 'LICENSE');

      expect(existsSync(path), `${workspace.name} declares a licence and ships no LICENSE file`).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe(ROOT_LICENSE);
    },
  );

  it.each(PACKAGES.map((workspace) => [workspace.name, workspace] as const))(
    '%s declares MIT',
    (_name, workspace) => {
      expect(workspace.manifest.license).toBe('MIT');
    },
  );
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
  /**
   * Upstream's resolver, vendored so the addon can carry a patch to it.
   *
   * It is somebody else's code under a patch, not code this repository wrote,
   * so its length is not a debt this list could pay: splitting it would only
   * make the patch harder to drop. It is excluded by directory, which is the
   * one exclusion by pattern here, and it leaves the repository when the patch
   * is dropped.
   */
  const VENDORED = 'packages/sense/native/vendor/oxc_resolver';

  const SOURCE = execFileSync(
    'git',
    ['ls-files', '--', '*.ts', '*.tsx', '*.mjs', '*.js', '*.jsx', '*.rs', `:(exclude)${VENDORED}`],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((file) => existsSync(join(ROOT, file)));

  const LIMIT = 500;

  /**
   * Files over the limit, each held at the length it has.
   *
   * This is a debt list rather than an exemption list, on the argument that a
   * file may leave it and may not join it. It held twenty-two TypeScript files
   * on the day the rule landed and emptied on 2026-08-04. It filled again when
   * the rule reached Rust, with what the addon had grown while nothing counted
   * it.
   *
   * Each entry carries its own ceiling, because a listed file that could grow
   * without bound would make the list an exemption after all. A file that
   * shrinks takes its ceiling down in the same change, so a line given back
   * stays given back. Why an entry is still here is a marker on the entry.
   */
  const OVERSIZE = new Map<string, number>([
    // FIXME: `journey.rs` is 6 lines over the limit, holding the fold's entry
    // points, its replay visitors and its bit-set helpers in one file. Moving one
    // of those groups into a module of its own closes this.
    ['packages/sense/native/src/journey.rs', 506],
  ]);

  /** Lines as `wc -l` counts them, plus a last line that has no newline after it. */
  const count = (text: string): number => {
    const breaks = text.split('\n').length - 1;
    return text === '' || text.endsWith('\n') ? breaks : breaks + 1;
  };

  const lines = (file: string): number => count(readFileSync(join(ROOT, file), 'utf8'));

  /** Each listed file that is shorter than its ceiling, which must come down to meet it. */
  const slack = (ceilings: ReadonlyMap<string, number>, length: (file: string) => number): string[] =>
    [...ceilings]
      .filter(([file, ceiling]) => length(file) < ceiling)
      .map(([file, ceiling]) => `${file}: ${length(file)} lines, held at ${ceiling}`);

  /** Why a file at this length breaks the rule, or nothing when it keeps it. */
  const refusal = (file: string, length: number, ceilings: ReadonlyMap<string, number>): string | undefined => {
    const ceiling = ceilings.get(file);
    if (ceiling === undefined) {
      return length > LIMIT ? `${file} has ${length} lines, over the limit of ${LIMIT}` : undefined;
    }
    return length > ceiling ? `${file} has ${length} lines, and the debt list holds it at ${ceiling}` : undefined;
  };

  it(`refuses a Rust file over ${LIMIT} lines that is not on the debt list`, () => {
    expect(refusal('native/src/grown.rs', LIMIT + 1, new Map())).toBe(
      `native/src/grown.rs has ${LIMIT + 1} lines, over the limit of ${LIMIT}`,
    );
    expect(refusal('native/src/kept.rs', LIMIT, new Map())).toBeUndefined();
  });

  it('counts lines as `wc -l` does, so a closing newline is not a line of its own', () => {
    expect(count('')).toBe(0);
    expect(count('\n')).toBe(1);
    expect(count('one\ntwo\n')).toBe(2);
    expect(count('one\ntwo')).toBe(2);
    expect(count('one\ntwo\n\n')).toBe(3);
  });

  it('measures a file on the debt list against its own ceiling rather than the limit', () => {
    const ceilings = new Map([['native/src/listed.rs', 539]]);

    expect(refusal('native/src/listed.rs', 520, ceilings)).toBeUndefined();
    expect(refusal('native/src/listed.rs', 539, ceilings)).toBeUndefined();
    expect(refusal('native/src/listed.rs', 540, ceilings)).toBe(
      'native/src/listed.rs has 540 lines, and the debt list holds it at 539',
    );
  });

  it('refuses a shrink that leaves the ceiling where it was', () => {
    const ceilings = new Map([['native/src/listed.rs', 539]]);

    expect(slack(ceilings, () => 520)).toEqual(['native/src/listed.rs: 520 lines, held at 539']);
    expect(slack(ceilings, () => 539)).toEqual([]);
  });

  it('counts Rust, so the rule cannot pass by never reading the addon', () => {
    expect(SOURCE).toContain('packages/sense/native/src/lib.rs');
  });

  it('leaves out the vendored resolver, and the directory it leaves out exists', () => {
    expect(existsSync(join(ROOT, VENDORED, 'src/lib.rs'))).toBe(true);
    expect(SOURCE.filter((file) => file.startsWith(`${VENDORED}/`))).toEqual([]);
  });

  it.each(SOURCE)(`%s is under ${LIMIT} lines, or under its ceiling on the debt list`, (file) => {
    expect(refusal(file, lines(file), OVERSIZE)).toBeUndefined();
  });

  it('has no entry on the debt list that is already under the limit', () => {
    // The list shortens by deleting a name once the file is split, and this is
    // what makes anyone bother: a fixed file that stays listed fails here.
    const fixed = [...OVERSIZE.keys()].filter((file) => existsSync(join(ROOT, file)) && lines(file) <= LIMIT);
    expect(fixed).toEqual([]);
  });

  it('holds each entry on the debt list at the length the file has, so a shrink is kept', () => {
    const present = new Map([...OVERSIZE].filter(([file]) => existsSync(join(ROOT, file))));
    expect(slack(present, lines)).toEqual([]);
  });

  it('has no entry on the debt list that no longer exists', () => {
    expect([...OVERSIZE.keys()].filter((file) => !existsSync(join(ROOT, file)))).toEqual([]);
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
