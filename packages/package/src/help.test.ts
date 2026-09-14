import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Entry, everyEntry, readHelp, undocumented } from './help.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

function entry(name: string, help = HELP): Entry {
  const found = [...everyEntry(help)].find(([, , candidate]) => candidate.name === name);
  if (found === undefined) throw new Error(`no entry named \`${name}\``);
  return found[2];
}

const HELP = readHelp(WORKSPACE);

describe('a workspace read three ways and joined', () => {
  it('is one entry per package that says it may be published', () => {
    expect(HELP.packages.map((published) => published.name)).toEqual(['alpha', 'beta', 'solo']);
  });

  it('carries where each name is declared, not where it is exported from', () => {
    expect(entry('measure')).toMatchObject({
      at: 'packages/alpha/src/values.ts',
      line: 12,
      kind: 'function',
    });
  });

  it('carries the head a name was written with, without the export in front of it', () => {
    // What a caller needs is the shape. Whether the file said `export type` or
    // exported it three lines later is the declaring file's business.
    expect(entry('Span').signature).toBe('type Span = readonly [number, number]');
  });

  it('carries the doc block above a declaration, undented', () => {
    expect(entry('measure').doc).toBe(
      'Measures the thing, and says how much of it there was.\n\n@returns how much of it there was',
    );
  });

  it('leaves a name that says nothing about itself without a doc, rather than inventing one', () => {
    expect(entry('Frame').doc).toBeUndefined();
  });

  it('says which packages reach for a name, and how many places do', () => {
    expect(entry('Shape')).toMatchObject({ usedBy: ['beta'], uses: 2 });
  });

  it('does not count a package as a consumer of itself', () => {
    // `alpha/index.ts` re-exports `Shape` from `alpha/shapes.ts`, which is a use
    // and is not an audience. Counting it would make every barrelled name look
    // load-bearing, which is exactly the ranking this reading exists to earn.
    expect(entry('Shape').usedBy).not.toContain('alpha');
  });

  it('ranks the names a subpath opens by how much of the repository reaches for them', () => {
    const opening = HELP.packages[0]?.openings[0];
    expect(opening?.subpath).toBe('.');
    expect(opening?.entries[0]?.name).toBe('Shape');
    expect(opening?.entries.map((held) => held.usedBy.length)).toEqual(
      [...(opening?.entries ?? [])].map((held) => held.usedBy.length).sort((a, b) => b - a),
    );
  });

  it('joins the kinds of one name into one entry', () => {
    // The reading is per name, and a name is declared once even when it is an
    // interface and a const. Two entries would be two things to document.
    expect(entry('grouped').kind).toBe('namespace');
  });

  it('reports a subpath nothing published, once per place that reached for it', () => {
    expect(HELP.deep.map((held) => `${held.by} ${held.specifier}`)).toEqual(['beta alpha/values']);
  });

  it('reads every file it walked', () => {
    expect(HELP.unreadable).toEqual([]);
  });

  it('reads the same workspace the same way twice', () => {
    expect(readHelp(WORKSPACE)).toEqual(HELP);
  });
});

describe('the documentation gap', () => {
  const gap = undocumented(HELP);

  it('is the names another package imports and which say nothing about themselves', () => {
    expect(gap.map((held) => held.name)).toEqual(['already']);
  });

  it('leaves out a name nothing imports, however undocumented it is', () => {
    // `Frame` has no doc and no consumer. It may be dead, and a page that mixed
    // it in with the names three packages import would bury the ones that matter
    // under the ones nobody asked about.
    expect(gap.map((held) => held.name)).not.toContain('Frame');
  });

  it('leaves out a documented name, however much it is imported', () => {
    expect(gap.map((held) => held.name)).not.toContain('measure');
  });

  it('is ordered by how many packages would read the paragraph', () => {
    expect(gap.map((held) => held.usedBy.length)).toEqual(
      [...gap].map((held) => held.usedBy.length).sort((a, b) => b - a),
    );
  });
});

const NEAR = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/near');
const NEARBY = readHelp(NEAR);

function near(name: string): Entry {
  return entry(name, NEARBY);
}

describe('where a name is written, not only who writes it', () => {
  it('keeps the file and line of every place a name is imported', () => {
    expect(near('measure').sites.map((site) => `${site.at}:${site.line}`)).toEqual([
      'packages/far/src/index.ts:1',
      'packages/near/src/index.stories.jsx:1',
      'packages/near/src/index.test.js:1',
      'packages/near/src/index.ts:1',
    ]);
  });

  it('says which of them are stories and tests, so an example can be told from a consumer', () => {
    const kinds = Object.fromEntries(near('measure').sites.map((site) => [site.at, site.kind]));
    expect(kinds).toEqual({
      'packages/far/src/index.ts': 'source',
      'packages/near/src/index.stories.jsx': 'story',
      'packages/near/src/index.test.js': 'test',
      'packages/near/src/index.ts': 'source',
    });
  });

  it('counts the same sites the audience is counted from', () => {
    // `usedBy` and `uses` are this list read two ways. A site list that could
    // disagree with the count beside it would make the ranking unfalsifiable.
    const entry = near('measure');
    expect(entry.uses).toBe(entry.sites.length);
    expect([...new Set(entry.sites.map((site) => site.by))].sort()).toEqual(['far', 'near']);
  });
});

describe('what a README says about a name with nothing above it', () => {
  it('finds the passage that names the symbol', () => {
    expect(near('Frame').mention).toMatchObject({ at: 'packages/lib/README.md' });
    expect(near('Frame').mention?.text).toContain('one captured moment');
  });

  it('prefers the README nearest the declaration over the one above it', () => {
    // Both name `Deeply`. The one beside the file that declares it is about that
    // file; the package's is about the package.
    expect(near('Deeply').mention?.at).toBe('packages/lib/src/inner/README.md');
  });

  it('says nothing for a name the prose never names', () => {
    expect(near('measure').mention).toBeUndefined();
  });

  it('leaves the doc comment alone where there is one', () => {
    // A paragraph about a package is not a comment about a declaration, and
    // merging the two would close the gap `undocumented` exists to report.
    expect(near('measure').doc).toBe('Measures the thing.');
    expect(undocumented(NEARBY).map((held) => held.name)).toContain('Frame');
  });

  it('returns a passage that names the symbol, every time', () => {
    for (const [, , held] of everyEntry(NEARBY)) {
      if (held.mention !== undefined) expect(held.mention.text).toContain(held.name);
    }
  });
});
