import { describe, expect, it } from 'vitest';
import { NO_ARGS } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { BY_PATH, QUIET, SUBPATHS_ONLY, busier, importOf } from '../__fixtures__/imported-by-path.js';
import { HELP_TOOLS } from '../tools.js';
import { entrypoint } from './entrypoint.js';
import { packages } from './packages.js';

/**
 * `docs_packages`, the question that takes no argument, and the questions its
 * answer names.
 *
 * It counts: per package, what other packages import from it by path and how
 * many imports reach past its entry. It lists no import. It names
 * `docs_entrypoint` on a package, which counts the imports per file, and that
 * answer names the specifier whose imports it lists.
 *
 * Kibana's shape is the reason. Its packages declare no entry, and other
 * packages import 141,632 of their files by path. Listing every one of those
 * imports printed 200,330 lines, and walking every import once per package
 * took 29.9 to 45.9 seconds on that one repository.
 */

describe('docs_packages', () => {
  it('takes no argument', () => {
    expect(packages.inputSchema).toEqual(NO_ARGS);
  });

  it('counts what each package is imported for, one row per package, and lists no import', () => {
    const text = packages.run(BY_PATH, {});

    expect(text).toMatch(/^@acme\/lib — 1 name, 1 imported elsewhere, 0 documented$/m);
    expect(text).toMatch(/^ {2}@acme\/kit — 2 names from 2 of its files$/m);
    expect(text).toMatch(/^ {2}@acme\/stamp — 1 name from 1 of its files$/m);
    expect(text).toMatch(/^2 imports reach past a published entrypoint\./m);
    expect(text).toMatch(/^ {2}@acme\/lib — 2 imports$/m);
    expect(text).not.toContain('apps/app/src/');
  });

  it('names `entrypoint` on the rows above as the narrower questions, each once', () => {
    const text = packages.run(BY_PATH, {});

    expect(text).toMatch(/^Narrower questions:$/m);
    expect(text.split('\n').filter((line) => line === '  variance ask entrypoint --package @acme/lib')).toHaveLength(1);
    expect(text).toMatch(/^ {2}variance ask entrypoint --package @acme\/kit$/m);
    expect(text).not.toContain('packages --package');
  });

  it('names the specifier first in code-unit order when two are imported equally', () => {
    const opening = (name: string) => ({
      name,
      declared: { main: 'src/index.ts' },
      openings: [
        {
          subpath: '.',
          source: `packages/${name.slice(6)}/src/index.ts`,
          entries: [{ name: 'one', kind: 'function' as const, at: `packages/${name.slice(6)}/src/one.ts`, line: 1, usedBy: ['@acme/app'], uses: 1, sites: [] }],
        },
      ],
    });
    const tied: Help = { ...BY_PATH, packages: [opening('@acme/zed'), opening('@acme/abc')], deep: [], byPath: [] };

    expect(packages.run(tied, {})).toMatch(/^ {2}variance ask entrypoint --package @acme\/abc$/m);
  });

  it('prints the counts `docs_entrypoint` prints for the same package', () => {
    const help = busier(3);
    const text = packages.run(help, {});
    const rows = [...text.matchAll(/^ {2}(@acme\/\S+) — (\d+ names? from \d+ of its files|\d+ imports?)$/gmu)];

    expect(rows.length).toBeGreaterThan(2);
    for (const [, owner, count] of rows) {
      const answer = entrypoint.run(help, { package: owner! });
      const imports = /^(\d+) imports?$/u.exec(count!)?.[1];
      const heading =
        imports === undefined
          ? `import ${count} by path, most imported first:`
          : `${imports} ${imports === '1' ? 'import reaches' : 'imports reach'} past a published entrypoint of ${owner}.`;
      expect(answer, owner).toContain(heading);
    }
  });

  it('names no door when no published name is imported anywhere', () => {
    const unused: Help = {
      ...BY_PATH,
      packages: BY_PATH.packages.map((published) => ({
        ...published,
        openings: published.openings.map((held) => ({ ...held, entries: held.entries.map((entry) => ({ ...entry, usedBy: [], uses: 0 })) })),
      })),
      deep: [],
    };

    expect(packages.run(unused, {})).not.toMatch(/entrypoint --package @acme\/lib$/m);
  });

  it('opens on its first row when no published package opens an entry', () => {
    const text = packages.run({ ...BY_PATH, packages: [{ name: '@acme/lib', declared: {}, openings: [] }] }, {});

    expect(text.split('\n')[0]).toBe('2 packages that declare no entry are imported by path, most names first:');
  });

  it('counts the packages whose declared entry this reading could not follow, the imports of that entry apart from the deep ones', () => {
    const text = packages.run(QUIET, {});

    expect(text).toContain(
      '1 package declares an entry this reading could not follow to a source file, such as a build output the checkout does not hold, ' +
        'so none of its names are listed. 1 import names an entry like that, most first:\n  @acme/quiet — 1 import',
    );
    expect(text).toMatch(/^1 import reaches past a published entrypoint\. .*:\n {2}@acme\/quiet — 1 import$/m);
    expect(text).toMatch(/^ {2}variance ask entrypoint --package @acme\/quiet$/m);
    expect(packages.run(BY_PATH, {})).not.toContain('could not follow');
  });

  it('is as long for a hundred imports of each file as for one', () => {
    expect(packages.run(busier(100), {}).split('\n')).toHaveLength(packages.run(BY_PATH, {}).split('\n').length);
  });

  it('reads each import a number of times that does not grow with the number of packages', () => {
    // Every package another package imports by path, once each. The answer
    // used to walk every import once per package, so the reads of one import
    // grew with the package count; counted through a getter on the field every
    // walk reads first, the reads per import must be the same at 10 and at 200.
    function readsPerImport(owners: number): number {
      let reads = 0;
      const byPath = Array.from({ length: owners }, (_, index) => {
        const held = importOf(`@acme/p${index}/src/file`, '@acme/app', `apps/app/src/f${index}.ts`, ['one']);
        return Object.defineProperty({ ...held }, 'specifier', {
          get: () => {
            reads += 1;
            return held.specifier;
          },
          enumerable: true,
        });
      });
      packages.run({ ...BY_PATH, deep: [], byPath }, {});
      return reads / owners;
    }

    expect(readsPerImport(200)).toBe(readsPerImport(10));
  });
});

/** Each command under `Narrower questions:`, as the tool it names and that tool's input. */
function followUps(text: string): readonly (readonly [string, Record<string, string>])[] {
  const lines = text.split('\n');
  const at = lines.indexOf('Narrower questions:');
  if (at < 0) return [];
  return lines.slice(at + 1).map((line) => {
    const [variance, ask, verb, ...flags] = line.trim().split(' ');
    expect(`${variance} ${ask} ${verb ?? ''}`).toMatch(/^variance ask \S+$/u);
    const input: Record<string, string> = {};
    for (let index = 0; index < flags.length; index += 2) input[flags[index]!.replace(/^--/u, '')] = flags[index + 1]!;
    return [`docs_${verb}`, input] as const;
  });
}

/** Every command the answer with no argument names, and every one their answers name, each asked once. */
function everyFollowUp(help: Help): readonly (readonly [string, string])[] {
  const answered: (readonly [string, string])[] = [];
  const asked = new Set<string>();
  let pending = followUps(packages.run(help, {}));
  while (pending.length > 0) {
    const next: (readonly [string, Record<string, string>])[] = [];
    for (const [name, input] of pending) {
      const question = `${name} ${JSON.stringify(input)}`;
      if (asked.has(question)) continue;
      asked.add(question);
      const tool = HELP_TOOLS.find((candidate) => candidate.name === name);
      if (tool === undefined) throw new Error(`${question}: no such tool`);
      const answer = tool.run(help, input);
      answered.push([question, answer]);
      next.push(...followUps(answer));
    }
    pending = next;
  }
  return answered;
}

describe('the narrower questions', () => {
  it('are each a question the tools answer', () => {
    const answered = everyFollowUp(BY_PATH);

    expect(answered.map(([question]) => question)).toEqual(
      expect.arrayContaining([
        'docs_entrypoint {"package":"@acme/lib"}',
        'docs_entrypoint {"package":"@acme/kit"}',
        'docs_uses {"name":"formatPrice","package":"@acme/lib/src/internal/format"}',
        'docs_uses {"name":"taxOf","package":"@acme/kit/src/money/tax"}',
        'docs_entrypoint {"package":"@acme/lib/src/internal/format"}',
      ]),
    );
  });

  it('answer for a package whose `exports` opens only subpaths, asked by its name', () => {
    const answered = everyFollowUp(SUBPATHS_ONLY);
    const srv = answered.find(([question]) => question === 'docs_entrypoint {"package":"@acme/srv"}');

    expect(srv).toBeDefined();
    expect(srv![1]).toMatch(/^ {2}@acme\/srv\/server — 1 name, 1 imported elsewhere, 0 documented$/m);
    expect(srv![1]).toContain('  @acme/srv/src/routes — 1 name, imported by 2 files');
    expect(answered.map(([question]) => question)).toContain('docs_entrypoint {"package":"@acme/srv/server"}');
    const routes = answered.find(([question]) => question === 'docs_entrypoint {"package":"@acme/srv/src/routes"}');
    expect(routes?.[1]).toContain('  @acme/srv/src/routes — @acme/app at apps/app/src/admin.ts:1');
  });

  it('name an import past an entry so that `uses` finds it, when the entry publishes the same name from another file', () => {
    // `greet` is published from packages/lib/src/greet.ts. The import past the
    // entry takes a `greet` from another file, and `uses` asked by the package
    // joins only the published one's sites.
    const shadowed: Help = { ...BY_PATH, deep: [importOf('@acme/lib/src/legacy', '@acme/app', 'apps/app/src/old.ts', ['greet'])], byPath: [] };

    const uses = everyFollowUp(shadowed).filter(([question]) => question.startsWith('docs_uses '));

    expect(uses.length).toBeGreaterThan(0);
    for (const [question, answer] of uses) expect(answer, question).toContain('apps/app/src/old.ts:1');
  });
});
