import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { treeOf, type FileRecord } from '@variance-authority/mcp/tools';
import { readHelp, type Help } from '@variance-authority/package/help';
import { taintTable } from '@variance-authority/sense/taint';
import { readWorkspace, refreshWorkspace } from './read.js';
import { search } from './tools/search.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

let index: string;
let walked: Help;
let indexed: Help;

beforeAll(async () => {
  index = join(await mkdtemp(join(tmpdir(), 'help-index-')), 'source-index.bin');
  walked = readHelp(WORKSPACE);
  indexed = await readWorkspace(WORKSPACE, { index });
});

afterAll(async () => {
  await rm(dirname(index), { recursive: true, force: true });
});

/** Every name with who reaches it and from where, flattened to something comparable. */
function sites(help: Help): readonly string[] {
  const found: string[] = [];
  for (const published of help.packages) {
    for (const opening of published.openings) {
      for (const entry of opening.entries) {
        for (const use of entry.sites) {
          found.push(`${published.name} ${opening.subpath} ${entry.name} <- ${use.by} ${use.at}:${use.line} ${use.kind}${use.type ? ' type' : ''}`);
        }
      }
    }
  }
  return found.sort();
}

/** Every exported name with where it is written, flattened to something comparable. */
function exported(help: Help): readonly string[] {
  return help.exported
    .map((name) => `${name.name} <- ${name.by} ${name.at}:${name.line} ${name.kind}${name.type ? ' type' : ''}`)
    .sort();
}

function entryNamed(help: Help, name: string) {
  return help.packages
    .flatMap((published) => published.openings)
    .flatMap((opening) => opening.entries)
    .find((entry) => entry.name === name);
}

async function copyWorkspace(prefix: string): Promise<{ readonly root: string; readonly temporary: string }> {
  const temporary = await mkdtemp(join(tmpdir(), prefix));
  const root = join(temporary, 'workspace');
  await cp(WORKSPACE, root, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'],
    { cwd: root },
  );
  return { root, temporary };
}

describe('reading a workspace through the source index', () => {
  it('returns the same help value without reparsing the published surface', () => {
    expect(indexed).toEqual(walked);
  });

  it('finds the same call sites the walk finds', () => {
    // The whole claim. Two readings of one checkout — one that opened every file
    // and one that opened almost none — have to agree site for site and line for
    // line, or the fast one is a different answer rather than the same answer
    // sooner.
    expect(sites(indexed)).toEqual(sites(walked));
  });

  it('ranks the same names in the same order', () => {
    const order = (help: Help) =>
      help.packages.flatMap((published) =>
        published.openings.flatMap((opening) =>
          opening.entries.map((entry) => `${opening.subpath} ${entry.name} ${entry.usedBy.length}/${entry.uses}`),
        ),
      );

    expect(order(indexed)).toEqual(order(walked));
  });

  it('finds the same exported names the walk finds', () => {
    // The wider half of the same claim. Most of a repository is exported and not
    // published, and the index is the only reading that can afford to look at
    // all of it — so it has to be the same list, not a bigger or a luckier one.
    expect(exported(indexed)).toEqual(exported(walked));
  });

  it('reads names no manifest publishes', () => {
    // Not a tautology against the line above: both readings agreeing on an empty
    // list would pass it. `kept` is exported by a file beta's entrypoint does not
    // re-export, so it is in neither workspace's published surface.
    expect(exported(indexed)).toContain('kept <- beta packages/beta/src/again.ts:3 source');
  });

  it('answers a second time from the index it just wrote', async () => {
    // Not a timing assertion — a timing assertion measures the machine. What is
    // checked is that the second reading is the same reading, because a cache
    // that answers differently on a hit is worse than no cache.
    expect(sites(await readWorkspace(WORKSPACE, { index }))).toEqual(sites(walked));
  });

  it('refreshes usage without rebuilding stable documentation', async () => {
    const { root, temporary } = await copyWorkspace('help-refresh-');
    try {
      const where = join(root, 'packages/alpha/src/values.ts');
      const first = await readWorkspace(root, { index: join(root, '.index') });
      const source = await readFile(where, 'utf8');
      await writeFile(where, source.replace('Measures the thing', 'Fresh words about the thing'));
      await writeFile(
        join(root, 'packages/beta/src/other.ts'),
        "import { measure } from 'alpha';\nmeasure(2);\n",
      );

      const refreshed = await refreshWorkspace(root, first, {
        index: join(root, '.index'),
        changed: ['packages/alpha/src/values.ts', 'packages/beta/src/other.ts'],
      });
      const measure = entryNamed(refreshed, 'measure');
      expect(measure?.doc).toContain('Measures the thing');
      expect(measure?.doc).not.toContain('Fresh words');
      expect(measure?.uses).toBe((entryNamed(first, 'measure')?.uses ?? 0) + 1);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('rebuilds documentation when a changed file introduces a symbol', async () => {
    const { root, temporary } = await copyWorkspace('help-refresh-symbol-');
    try {
      const index = join(root, '.index');
      const first = await readWorkspace(root, { index });
      const values = join(root, 'packages/alpha/src/values.ts');
      const barrel = join(root, 'packages/alpha/src/index.ts');
      await writeFile(
        values,
        `${await readFile(values, 'utf8')}\n/** New on this turn. */\nexport const introduced = true;\n`,
      );
      await writeFile(
        barrel,
        `${await readFile(barrel, 'utf8')}\nexport { introduced } from './values.js';\n`,
      );

      const refreshed = await refreshWorkspace(root, first, {
        index,
        changed: ['packages/alpha/src/index.ts', 'packages/alpha/src/values.ts'],
      });
      const introduced = entryNamed(refreshed, 'introduced');
      expect(introduced?.doc).toBe('New on this turn.');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('accepts the caller\'s exact changed-file list without changing the reading', async () => {
    expect(await readWorkspace(WORKSPACE, { index, changed: [] })).toEqual(walked);
  });

  it('leaves the index alone when asked not to save', async () => {
    const untouched = join(dirname(index), 'unsaved.bin');
    expect(sites(await readWorkspace(WORKSPACE, { index: untouched, save: false }))).toEqual(sites(walked));
    // A second reading against a file nothing wrote is a cold reading, and cold
    // is the same answer.
    expect(sites(await readWorkspace(WORKSPACE, { index: untouched, save: false }))).toEqual(sites(walked));
  });

  it('joins declarative module loads onto the graph without inventing symbol uses', async () => {
    let records: readonly FileRecord[] = [];
    const taint = taintTable('loaders', {
      'packages/beta/src/again.ts': { '+': ['./inner/deeper'] },
    });
    const help = await readWorkspace(WORKSPACE, {
      index,
      taints: [taint],
      records: (drawn) => {
        records = drawn;
      },
    });

    const answer = search.run(
      help,
      { query: 'behind', from: 'packages/beta/src/again.ts' },
      { tree: treeOf(records, WORKSPACE) },
    );
    expect(answer).toContain('reachable from `packages/beta/src/again.ts`');
    // The taint reaches the loaded module, whose ordinary `behind` import
    // contributes one usage. It does not pretend the loader bound it itself.
    expect(answer).toContain('1 file, 1 import in this area');
    expect(answer).toContain('files by distance: 1: 1');
  });

  it('refuses to flatten a file-relative shadow into the workspace tree', async () => {
    const taint = taintTable('mocks', {
      'packages/beta/src/again.ts': { '-': ['../../alpha/src/index'] },
    });
    await expect(readWorkspace(WORKSPACE, { index, taints: [taint] })).rejects.toThrow(
      /cannot apply subtractive taints/,
    );
  });
});
