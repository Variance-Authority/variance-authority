import { describe, expect, it } from 'vitest';
import { NO_ARGS } from '@variance-authority/mcp/tools';
import type { Deep, Help } from '@variance-authority/package/help';
import { HELP_TOOLS } from '../tools.js';
import { entrypoint } from './entrypoint.js';
import { packages } from './packages.js';

/**
 * Imports by path, as the two questions about packages answer them.
 *
 * `docs_packages` takes no argument and counts: per package, what other
 * packages import from it by path and how many imports reach past its entry. It
 * lists no import, and it names the question that does. `docs_entrypoint` on a
 * package or a specifier is that question: it lists the import sites behind the
 * counts.
 *
 * Kibana's shape is the reason. Its packages declare no entry, and other
 * packages import 141,632 of their files by path. Listing every one of those
 * imports printed 200,330 lines, and walking every import once per package
 * took 30 to 45 seconds on that one repository.
 */

/** An import of `specifier` by `by`, at `at`, taking `names`. */
function importOf(specifier: string, by: string, at: string, names: readonly string[]): Deep {
  return {
    specifier,
    by,
    at,
    line: 1,
    to: `${specifier.replace(/^@acme\//u, 'packages/')}.ts`,
    names: names.map((name, index) => ({ name, by, at, line: index + 1, kind: 'source' as const, type: false })),
  };
}

const HELP: Help = {
  packages: [
    {
      name: '@acme/lib',
      declared: { main: 'src/index.ts' },
      openings: [
        {
          subpath: '.',
          source: 'packages/lib/src/index.ts',
          entries: [{ name: 'greet', kind: 'function', at: 'packages/lib/src/greet.ts', line: 1, usedBy: ['@acme/app'], uses: 1, sites: [] }],
        },
      ],
    },
  ],
  deep: [
    importOf('@acme/lib/src/internal/math', '@acme/app', 'apps/app/src/total.ts', ['addTax']),
    importOf('@acme/lib/src/internal/format', '@acme/app', 'apps/app/src/label.ts', ['formatPrice']),
  ],
  byPath: [
    importOf('@acme/kit/src/money/tax', '@acme/app', 'apps/app/src/checkout.ts', ['taxOf']),
    importOf('@acme/kit/src/ui/Button', '@acme/app', 'apps/app/src/checkout.ts', ['Button']),
    importOf('@acme/kit/src/money/tax', '@acme/kit', 'packages/kit/src/self.ts', ['taxOf']),
    importOf('@acme/stamp/src/stamp', '@acme/app', 'apps/app/src/stamped.ts', ['stamp']),
  ],
  exported: [],
  unreadable: [],
};

/** `HELP` with `more` imports of each file another package imports by path. */
function busier(more: number): Help {
  const again = (held: Deep, index: number): Deep => ({ ...held, at: held.at.replace(/\.ts$/u, `-${index}.ts`) });
  return {
    ...HELP,
    deep: [...HELP.deep, ...Array.from({ length: more }, (_, index) => HELP.deep.map((held) => again(held, index))).flat()],
    byPath: [...HELP.byPath, ...Array.from({ length: more }, (_, index) => HELP.byPath.map((held) => again(held, index))).flat()],
  };
}

/** A package that declares an entry and opens nothing, and one import past it. */
const QUIET: Help = {
  ...HELP,
  packages: [...HELP.packages, { name: '@acme/quiet', declared: { main: 'gone.js' }, openings: [] }],
  deep: [importOf('@acme/quiet/src/hush', '@acme/app', 'apps/app/src/hushed.ts', ['hush'])],
  byPath: [],
};

describe('docs_packages', () => {
  it('takes no argument', () => {
    expect(packages.inputSchema).toEqual(NO_ARGS);
  });

  it('counts what each package is imported for, one row per package, and lists no import', () => {
    const text = packages.run(HELP, {});

    expect(text).toMatch(/^@acme\/lib — 1 name, 1 imported elsewhere, 0 documented$/m);
    expect(text).toMatch(/^ {2}@acme\/kit — 2 names from 2 of its files$/m);
    expect(text).toMatch(/^ {2}@acme\/stamp — 1 name from 1 of its files$/m);
    expect(text).toMatch(/^2 imports reach past a published entrypoint\./m);
    expect(text).toMatch(/^ {2}@acme\/lib — 2 imports$/m);
    expect(text).not.toContain('apps/app/src/');
  });

  it('names `entrypoint` on the rows above as the narrower questions, each once', () => {
    const text = packages.run(HELP, {});

    expect(text).toMatch(/^Narrower questions:$/m);
    expect(text.split('\n').filter((line) => line === '  variance ask entrypoint --package @acme/lib')).toHaveLength(1);
    expect(text).toMatch(/^ {2}variance ask entrypoint --package @acme\/kit$/m);
    expect(text).not.toContain('packages --package');
  });

  it('names no door when no published name is imported anywhere', () => {
    const unused: Help = {
      ...HELP,
      packages: HELP.packages.map((published) => ({
        ...published,
        openings: published.openings.map((held) => ({ ...held, entries: held.entries.map((entry) => ({ ...entry, usedBy: [], uses: 0 })) })),
      })),
      deep: [],
    };

    expect(packages.run(unused, {})).not.toMatch(/entrypoint --package @acme\/lib$/m);
  });

  it('opens on its first row when no published package opens an entry', () => {
    const text = packages.run({ ...HELP, packages: [{ name: '@acme/lib', declared: {}, openings: [] }] }, {});

    expect(text.split('\n')[0]).toBe('2 packages declare no entry. Other packages import their files by path, most names first:');
  });

  it('is as long for a hundred imports of each file as for one', () => {
    expect(packages.run(busier(100), {}).split('\n')).toHaveLength(packages.run(HELP, {}).split('\n').length);
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
      packages.run({ ...HELP, deep: [], byPath }, {});
      return reads / owners;
    }

    expect(readsPerImport(200)).toBe(readsPerImport(10));
  });
});

describe('docs_entrypoint on a package other packages import by path', () => {
  it('lists what other packages import from a package that declares no entry, its own imports left out', () => {
    const text = entrypoint.run(HELP, { package: '@acme/kit' });

    expect(text).toMatch(/^@acme\/kit declares no entry: no `exports`, `main` or `types`\. Other packages import 2 names from 2 of its files by path:$/m);
    expect(text).toContain('  @acme/kit/src/money/tax — taxOf — @acme/app at apps/app/src/checkout.ts:1');
    expect(text).toContain('  @acme/kit/src/ui/Button — Button — @acme/app at apps/app/src/checkout.ts:1');
    expect(text).not.toContain('packages/kit/src/self.ts');
    expect(text).not.toContain('@acme/stamp');
    expect(text).toMatch(/^ {2}variance ask entrypoint --package @acme\/kit\/src\/money\/tax$/m);
    expect(text).toMatch(/^ {2}variance ask uses --name taxOf --package @acme\/kit\/src\/money\/tax$/m);
  });

  it('lists every import past the entry of a package that declares one, after the names its entry opens', () => {
    const text = entrypoint.run(HELP, { package: '@acme/lib' });

    expect(text.startsWith('@acme/lib — 1 names\n')).toBe(true);
    expect(text).toMatch(/^2 imports reach past a published entrypoint of @acme\/lib\./m);
    expect(text.indexOf('greet [function]')).toBeLessThan(text.indexOf('imports reach past'));
    expect(text).toContain('  @acme/lib/src/internal/math — @acme/app at apps/app/src/total.ts:1');
    expect(text).toContain('  @acme/lib/src/internal/format — @acme/app at apps/app/src/label.ts:1');
    expect(text).toMatch(/^ {2}variance ask uses --name formatPrice --package @acme\/lib\/src\/internal\/format$/m);
  });

  it('takes one specifier past the entry, unsplit or split, and answers for that specifier alone', () => {
    const text = entrypoint.run(HELP, { package: '@acme/lib/src/internal/math' });

    expect(text).toMatch(/^1 import reaches past a published entrypoint of @acme\/lib\./m);
    expect(text).toContain('  @acme/lib/src/internal/math — @acme/app at apps/app/src/total.ts:1');
    expect(text).not.toContain('format');
    expect(entrypoint.run(HELP, { package: '@acme/lib', subpath: './src/internal/math' })).toBe(text);
  });

  it('says the counts are floors when a file could not be read', () => {
    const text = entrypoint.run({ ...HELP, unreadable: ['apps/app/src/broken.ts'] }, { package: '@acme/lib' });

    expect(text).toMatch(/^1 file could not be read, so these imports are a floor; `variance ask packages` lists it\.$/m);
  });

  it('lists the imports past the entry of a package that opens none', () => {
    const text = entrypoint.run(QUIET, { package: '@acme/quiet' });

    expect(text).toMatch(/^@acme\/quiet opens no entry\.$/m);
    expect(text).toContain('  @acme/quiet/src/hush — @acme/app at apps/app/src/hushed.ts:1');
  });

  it('refuses a specifier nothing opens and nothing imports, saying which of the two its package lacks', () => {
    expect(() => entrypoint.run(QUIET, { package: '@acme/quiet/src/nowhere' })).toThrow(
      '`@acme/quiet/src/nowhere`: @acme/quiet opens no entry, and no other package imports this specifier',
    );
    expect(() => entrypoint.run(HELP, { package: '@acme/lib/src/nowhere' })).toThrow(/does not open `\.\/src\/nowhere`; it opens: \.$/);
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
    const answered = everyFollowUp(HELP);

    expect(answered.map(([question]) => question)).toEqual(
      expect.arrayContaining([
        'docs_entrypoint {"package":"@acme/lib"}',
        'docs_entrypoint {"package":"@acme/kit"}',
        'docs_uses {"name":"formatPrice","package":"@acme/lib/src/internal/format"}',
        'docs_uses {"name":"taxOf","package":"@acme/kit/src/money/tax"}',
      ]),
    );
  });

  it('name an import past an entry so that `uses` finds it, when the entry publishes the same name from another file', () => {
    // `greet` is published from packages/lib/src/greet.ts. The import past the
    // entry takes a `greet` from another file, and `uses` asked by the package
    // joins only the published one's sites.
    const shadowed: Help = { ...HELP, deep: [importOf('@acme/lib/src/legacy', '@acme/app', 'apps/app/src/old.ts', ['greet'])], byPath: [] };

    const uses = everyFollowUp(shadowed).filter(([question]) => question.startsWith('docs_uses '));

    expect(uses.length).toBeGreaterThan(0);
    for (const [question, answer] of uses) expect(answer, question).toContain('apps/app/src/old.ts:1');
  });
});
