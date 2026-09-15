import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readHelp } from '@variance-authority/package/help';
import { HELP, HELP_TOOLS, audience } from './tools.js';
import { serveWorkspace } from './server.js';
import { writePages } from './write.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');
const READING = readHelp(WORKSPACE);

function call(name: string, args: Record<string, unknown> = {}): string {
  const tool = HELP_TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`no tool named \`${name}\``);
  return tool.run(READING, args);
}

describe('the first question', () => {
  it('answers with the specifiers every other tool takes as an argument', () => {
    // The whole reason this tool is first. A model that has to guess a package
    // name to ask anything will guess, and a wrong guess reads exactly like a
    // workspace that does not publish the thing.
    const text = call('docs_packages');
    expect(text).toContain('alpha —');
    expect(text).toContain('alpha/deep —');
    expect(text).toContain('beta —');
  });

  it('says how much of each door is used and documented', () => {
    expect(call('docs_packages')).toMatch(/alpha — \d+ names, \d+ imported elsewhere, \d+ documented/);
  });

  it('reports a specifier that reaches past a published entrypoint', () => {
    const reaching = {
      ...READING,
      deep: [{ specifier: 'alpha/values', by: 'beta', at: 'packages/beta/src/index.ts', line: 2 }],
    };
    const tool = HELP_TOOLS.find((candidate) => candidate.name === 'docs_packages')!;
    expect(tool.run(reaching, {})).toContain('alpha/values — beta at packages/beta/src/index.ts:2');
  });

  it('says when a file could not be read, because a missed import makes a live name look dead', () => {
    const partial = { ...READING, unreadable: ['packages/beta/src/broken.ts'] };
    const tool = HELP_TOOLS.find((candidate) => candidate.name === 'docs_packages')!;
    expect(tool.run(partial, {})).toContain('the usage counts above are floors');
  });
});

describe('what one door opens', () => {
  it('is ranked by how much of the repository reaches for each name', () => {
    const names = call('docs_entrypoint', { package: 'alpha' })
      .split('\n')
      .slice(2)
      .map((line) => line.split(' ')[0]);
    expect(names[0]).toBe('Reading');
  });

  it('carries the kind, the counts and the first line of the doc', () => {
    expect(call('docs_entrypoint', { package: 'alpha' })).toContain(
      'measure [function] 1 packages, 1 imports — Measures the thing, and says how much of it there was.',
    );
  });

  it('marks a name that says nothing about itself', () => {
    expect(call('docs_entrypoint', { package: 'alpha' })).toContain('Reading [class] 1 packages, 2 imports — UNDOCUMENTED');
  });

  it('answers the main entrypoint when no subpath is named', () => {
    expect(call('docs_entrypoint', { package: 'alpha' }).startsWith('alpha — ')).toBe(true);
  });

  it('names what is there when a package is not', () => {
    expect(() => call('docs_entrypoint', { package: 'gamma' })).toThrow(/this workspace publishes: alpha, beta/);
  });

  it('names the doors that are there when a subpath is not', () => {
    expect(() => call('docs_entrypoint', { package: 'alpha', subpath: './nope' })).toThrow(/it opens: \., \.\/deep/);
  });
});

describe('one name in full', () => {
  const text = call('docs_symbol', { name: 'measure' });

  it('gives the import line a caller would write', () => {
    expect(text).toContain("import { measure } from 'alpha';");
  });

  it('gives the place, the signature and the whole doc', () => {
    expect(text).toContain('declared at packages/alpha/src/values.ts:6');
    expect(text).toContain('function measure(width: number): number');
    expect(text).toContain('The second paragraph, which a list has no room for.');
  });

  it('says who reaches for it', () => {
    expect(text).toContain('used by 1 package: beta — 1 import');
  });

  it('says outright when a name is silent, rather than leaving a blank', () => {
    expect(call('docs_symbol', { name: 'Reading' })).toContain('Nothing is written above this declaration.');
  });

  it('refuses an unknown name by pointing at the question that finds one', () => {
    expect(() => call('docs_symbol', { name: 'nope' })).toThrow(/ask `search`/);
  });

  it('refuses an empty name rather than answering about the first thing it finds', () => {
    expect(() => call('docs_symbol', {})).toThrow(/`name` is required/);
  });
});

describe('what the workspace says when the declaration says nothing', () => {
  const text = call('docs_symbol', { name: 'Reading' });

  it('finds the README passage that names it, and says which file that was', () => {
    expect(text).toContain('packages/alpha/README.md:');
    expect(text).toContain('A `Reading` is one measurement, kept.');
  });

  it('still reports the declaration as silent, rather than passing prose off as a doc', () => {
    // The sentence is the contract `docs_gaps` counts on. A README paragraph is
    // written about a package and may not describe the signature above it.
    expect(text).toContain('Nothing is written above this declaration.');
    expect(call('docs_gaps')).toContain('Reading');
  });

  it('says only that a name is silent when no prose names it either', () => {
    expect(call('docs_symbol', { name: 'Span' })).not.toContain('README.md');
  });
});

describe('where the repository already writes a name', () => {
  it('names every place it is imported, with a line to open', () => {
    const text = call('docs_uses', { name: 'behind' });
    expect(text).toContain('`behind` is imported in 4 places.');
    expect(text).toContain('packages/beta/src/index.ts:2 — beta');
  });

  it('separates the files written to show it in use from the ones that depend on it', () => {
    const text = call('docs_uses', { name: 'behind' });
    expect(text).toContain('Stories — written to show it in use:');
    expect(text).toContain('packages/beta/src/again.stories.jsx:1');
    expect(text).toContain('Tests — written to pin what it does:');
    expect(text).toContain('packages/beta/src/again.test.js:1');
  });

  it('puts the sites that share most of their path with a named file first', () => {
    const text = call('docs_uses', { name: 'behind', from: 'packages/beta/src/inner/other.ts' });
    const inner = text.indexOf('packages/beta/src/inner/deeper.ts');
    const outer = text.indexOf('packages/beta/src/index.ts');
    expect(inner).toBeGreaterThan(-1);
    expect(outer).toBeGreaterThan(-1);
    expect(inner).toBeLessThan(outer);
  });

  it('orders by path when no file is named, and says so rather than implying a ranking', () => {
    expect(call('docs_uses', { name: 'behind' })).toContain('pass `from`');
    expect(call('docs_uses', { name: 'behind', from: 'packages/beta/src/inner/other.ts' })).toContain(
      'Nearest first',
    );
  });

  it('answers plainly when a published name is imported by nothing', () => {
    expect(call('docs_uses', { name: 'Span' })).toContain('nothing in this workspace imports it');
  });

  it('refuses an unknown name by pointing at the question that finds one', () => {
    expect(() => call('docs_uses', { name: 'nope' })).toThrow(/ask `search`/);
  });
});

describe('finding a name somebody can only describe', () => {
  it('matches the documentation, not only the name', () => {
    expect(call('docs_search', { query: 'how much of it' })).toContain('measure');
  });

  it('matches a name case-insensitively', () => {
    expect(call('docs_search', { query: 'READING' })).toContain('Reading');
  });

  it('carries the specifier each result is published from', () => {
    expect(call('docs_search', { query: 'behind' })).toContain('alpha/deep · behind');
  });

  it('says nothing matched, and what to do instead', () => {
    expect(call('docs_search', { query: 'zzz' })).toContain('`packages` lists every entrypoint');
  });

  it('finds a name the repository exports and no manifest publishes', () => {
    // `deeper` is exported from a file inside beta that beta's entrypoint never
    // re-exports, which is what most code in most repositories is. A search that
    // only read the published surface would answer that this workspace has no
    // such name, which is false about the checkout it just read.
    const text = call('docs_search', { query: 'deeper' });
    expect(text).toContain('Nothing published matches');
    expect(text).toContain('deeper — beta · packages/beta/src/inner/deeper.ts:3');
  });

  it('reports a published name as published, and not twice', () => {
    const text = call('docs_search', { query: 'behind' });
    expect(text).toContain('alpha/deep · behind');
    // `behind` is exported by the file that declares it as well as published by
    // the manifest, so a second section naming it would report one name as two
    // findings and send the reader to the weaker of them.
    expect(text).not.toContain('exported somewhere in the repository');
  });
});

describe('the gap', () => {
  it('is the names another package imports and which say nothing', () => {
    const text = call('docs_gaps');
    expect(text).toContain('Reading [class] packages/alpha/src/values.ts:10 — used by 1 package: beta');
  });

  it('leaves out a name nothing outside its package imports', () => {
    expect(call('docs_gaps')).not.toContain('widths');
  });

  it('says so plainly when there is no gap', () => {
    const tool = HELP_TOOLS.find((candidate) => candidate.name === 'docs_gaps')!;
    expect(tool.run({ ...READING, packages: [] }, {})).toContain('carries documentation');
  });
});

describe('who imports a name', () => {
  const entry = {
    name: 'Viewport',
    kind: 'interface',
    at: 'packages/core/src/format/environment.ts',
    line: 73,
    usedBy: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    uses: 21,
  };

  it('leads with the count, because that is what a reader ranks on', () => {
    expect(audience(entry, 12)).toBe('7 packages: a, b, c, d, e, f, g');
  });

  it('says outright when it stopped naming them', () => {
    // A capped list that does not say so reads as a complete one, and the
    // reader's next move depends on knowing which of the two they got.
    expect(audience(entry, 3)).toBe('7 packages: a, b, c, and 4 more');
  });
});

describe('the server', () => {
  it('announces the five tools over the protocol it shares with the report server', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const stop = serveWorkspace(WORKSPACE, { input, output });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);

    const line = await new Promise<string>((resolve) => output.once('data', resolve));
    stop();

    const listed = JSON.parse(String(line)).result.tools as { name: string }[];
    expect(listed.map((tool) => tool.name)).toEqual(HELP_TOOLS.map((tool) => tool.name));
  });

  it('calls itself something other than the report server, so a client can tell them apart', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const stop = serveWorkspace(WORKSPACE, { input, output });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`);

    const line = await new Promise<string>((resolve) => output.once('data', resolve));
    stop();

    expect(JSON.parse(String(line)).result.serverInfo.name).toBe(HELP.name);
  });

  it('answers a tool call from the workspace on disk', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const stop = serveWorkspace(WORKSPACE, { input, output });
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'docs_symbol', arguments: { name: 'measure' } },
      })}\n`,
    );

    const line = await new Promise<string>((resolve) => output.once('data', resolve));
    stop();

    expect(JSON.parse(String(line)).result.content[0].text).toContain("import { measure } from 'alpha';");
  });
});

describe('the same answers as files', () => {
  it('writes four, and names the workspace from its own manifest', async () => {
    const out = await mkdtemp(join(tmpdir(), 'help-pages-'));
    try {
      const written = writePages(WORKSPACE, out);
      expect(written.map((file) => file.at.slice(out.length + 1))).toEqual([
        'llms.txt',
        'help-index.md',
        'help-gaps.md',
        'help.json',
      ]);

      const llms = await readFile(join(out, 'llms.txt'), 'utf8');
      expect(llms.startsWith('# fixture-help\n\n> Two packages, one of which uses the other.\n')).toBe(true);

      // The reading itself, because every page above it is a rendering decision
      // somebody will disagree with, and disagreeing should cost a JSON.parse.
      const reading = JSON.parse(await readFile(join(out, 'help.json'), 'utf8'));
      expect(reading.packages.map((held: { name: string }) => held.name)).toEqual(['alpha', 'beta']);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
