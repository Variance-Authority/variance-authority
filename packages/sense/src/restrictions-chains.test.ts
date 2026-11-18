import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { publishedSelectionQuestions } from './published-selection.js';
import { updateSourceIndex } from './published.js';
import { chainBetween, relationBetween, restrictedImports, type ChainViolation, type RuleFile } from './restrictions.js';

type Kind = 'imports' | 'type' | 'dynamic';
type Row = { readonly file: string; readonly edges: readonly { readonly to: string; readonly kind: Kind }[] };
const record = (file: string, ...targets: (string | [string, Kind])[]): Row => ({
  file,
  edges: targets.map((target) => (typeof target === 'string' ? { to: target, kind: 'imports' as const } : { to: target[0], kind: target[1] })),
});

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const WRITTEN: Record<Kind, (request: string) => string> = {
  imports: (request) => `import '${request}';`,
  type: (request) => `import type { Value } from '${request}';\nexport type Held = Value;`,
  dynamic: (request) => `export const later = () => import('${request}');`,
};

/** The chains the selection graph finds in a checkout written from `records`, indexed and asked as `variance restrictions` asks. */
async function restrictedChains(records: readonly Row[], files: readonly RuleFile[], seeds: readonly string[]): Promise<readonly ChainViolation[]> {
  const root = await mkdtemp(join(tmpdir(), 'va-chains-'));
  roots.push(root);
  const written = new Map(records.map((row) => [row.file, row.edges]));
  for (const row of records) for (const edge of row.edges) if (!written.has(edge.to)) written.set(edge.to, []);
  for (const [file, edges] of written) {
    const lines = edges.map((edge) => {
      const target = relative(dirname(file), edge.to);
      return WRITTEN[edge.kind](target.startsWith('.') ? target : `./${target}`);
    });
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), `${lines.join('\n')}\nexport type Value = 1;\n`);
  }
  await updateSourceIndex(root);
  const graph = await publishedSelectionQuestions(root, { dirs: ['.'], raw: true });
  return graph.restrictions(files, seeds).chains;
}

/** Nothing a package ships rests on `tools/`, nor on anything outside `packages/`. */
const offering: RuleFile[] = [
  {
    directory: '',
    rules: [
      { from: 'packages/*', to: 'tools/*', type: 'restricted', transitive: true, message: 'packages never rest on tools' },
      { from: 'packages/*', to: 'packages/*', type: 'allowed', transitive: true },
      { from: 'packages/*', to: '*', type: 'restricted', transitive: true, message: 'the offering rests on the offering' },
    ],
  },
];

describe('a transitive rule', () => {
  it('is not one of the rules an import is decided by, and an import rule decides no chain', () => {
    expect(relationBetween(offering, 'packages/cli/a.ts', 'tools/unrun.mjs')).toBeUndefined();
    expect(restrictedImports([record('packages/cli/a.ts', 'tools/unrun.mjs')], offering)).toEqual([]);
    expect(chainBetween(offering, 'packages/cli/a.ts', 'tools/unrun.mjs')?.rule.message).toBe('packages never rest on tools');
    const edges: RuleFile[] = [{ directory: '', rules: [{ from: 'packages/*', to: 'tools/*', type: 'restricted' }] }];
    expect(chainBetween(edges, 'packages/cli/a.ts', 'tools/unrun.mjs')).toBeUndefined();
  });
});

describe('the chains the selection graph restricts', () => {
  const records = [
    record('packages/cli/a.ts', 'packages/cli/b.ts'),
    record('packages/cli/b.ts', 'examples/helper.ts'),
    record('packages/cli/c.ts', 'examples/helper.ts'),
    record('packages/sense/x.ts', 'packages/cli/a.ts'),
    record('examples/helper.ts', 'tools/unrun.mjs'),
  ];
  const seeds = ['packages/cli/a.ts', 'packages/cli/b.ts', 'packages/cli/c.ts', 'packages/sense/x.ts'];

  it('reports the import that first leaves the offering, once, with its shortest chain and every seed behind it', async () => {
    expect(await restrictedChains(records, offering, seeds)).toEqual([
      {
        from: 'packages/cli/b.ts',
        to: 'examples/helper.ts',
        directory: '',
        message: 'the offering rests on the offering',
        chain: ['packages/cli/b.ts'],
        seeds: 3,
      },
      {
        from: 'packages/cli/c.ts',
        to: 'examples/helper.ts',
        directory: '',
        message: 'the offering rests on the offering',
        chain: ['packages/cli/c.ts'],
        seeds: 1,
      },
    ]);
  });

  it('does not walk through a restricted file, so what lies past it is not reported again', async () => {
    const found = await restrictedChains(records, offering, seeds);
    expect(found.some((finding) => finding.to === 'tools/unrun.mjs')).toBe(false);
  });

  it('follows every edge kind, a type-only import and an `import()` included', async () => {
    const typed = [record('packages/ui/a.ts', ['packages/ui/b.d.ts', 'type']), record('packages/ui/b.d.ts', ['tools/types.ts', 'dynamic'])];
    const found = await restrictedChains(typed, offering, ['packages/ui/a.ts']);
    expect(found.map((finding) => [finding.from, finding.to, finding.message, finding.chain])).toEqual([
      ['packages/ui/b.d.ts', 'tools/types.ts', 'packages never rest on tools', ['packages/ui/a.ts', 'packages/ui/b.d.ts']],
    ]);
  });

  it('reports a chain arriving in a shipped file the rule restricts, and still walks from that file', async () => {
    const sealed: RuleFile[] = [
      {
        directory: '',
        rules: [
          { from: 'packages/*', to: 'packages/secret/*', type: 'restricted', transitive: true, message: 'the secret is sealed' },
          { from: 'packages/*', to: 'tools/*', type: 'restricted', transitive: true, message: 'packages never rest on tools' },
        ],
      },
    ];
    const graph = [
      record('packages/app/a.ts', 'packages/app/b.ts'),
      record('packages/app/b.ts', 'packages/secret/s.ts'),
      record('packages/secret/s.ts', 'tools/x.ts'),
    ];
    const found = await restrictedChains(graph, sealed, ['packages/app/a.ts', 'packages/secret/s.ts']);
    // `a.ts` is behind the import into the secret and not behind the secret's
    // own import: its chain broke the rule on arriving in `s.ts`.
    expect(found.map((finding) => [finding.from, finding.to, finding.message, finding.chain, finding.seeds])).toEqual([
      ['packages/app/b.ts', 'packages/secret/s.ts', 'the secret is sealed', ['packages/app/a.ts', 'packages/app/b.ts'], 1],
      ['packages/secret/s.ts', 'tools/x.ts', 'packages never rest on tools', ['packages/secret/s.ts'], 1],
    ]);
  });

  it('counts a restricted seed behind the import its own chain reaches, and no seed past it', async () => {
    const sealed: RuleFile[] = [
      {
        directory: '',
        rules: [
          { from: 'packages/*', to: 'packages/secret/*', type: 'restricted', transitive: true, message: 'the secret is sealed' },
          { from: 'packages/*', to: 'tools/*', type: 'restricted', transitive: true, message: 'packages never rest on tools' },
        ],
      },
    ];
    const graph = [
      record('packages/app/a.ts', 'packages/secret/s.ts'),
      record('packages/secret/s.ts', 'packages/app/c.ts'),
      record('packages/app/c.ts', 'tools/x.ts'),
    ];
    const found = await restrictedChains(graph, sealed, ['packages/app/a.ts', 'packages/secret/s.ts']);
    expect(found.map((finding) => [finding.from, finding.to, finding.chain, finding.seeds])).toEqual([
      ['packages/app/a.ts', 'packages/secret/s.ts', ['packages/app/a.ts'], 1],
      ['packages/app/c.ts', 'tools/x.ts', ['packages/secret/s.ts', 'packages/app/c.ts'], 1],
    ]);
  });

  it('starts only from the seeds, so a test file that reaches outside is not a finding', async () => {
    const tested = [record('packages/cli/a.test.ts', 'tools/fixture.ts'), record('packages/cli/a.ts')];
    expect(await restrictedChains(tested, offering, ['packages/cli/a.ts'])).toEqual([]);
  });

  it('reads the rule file nearest the seed, so a folder can open a chain the root closes', async () => {
    const opened: RuleFile[] = [...offering, { directory: 'packages/docs', rules: [{ from: '.', to: '*', type: 'allowed', transitive: true }] }];
    const docs = [record('packages/docs/a.ts', 'examples/helper.ts'), record('packages/cli/a.ts', 'examples/helper.ts')];
    const found = await restrictedChains(docs, opened, ['packages/docs/a.ts', 'packages/cli/a.ts']);
    expect(found.map((finding) => finding.from)).toEqual(['packages/cli/a.ts']);
  });
});
