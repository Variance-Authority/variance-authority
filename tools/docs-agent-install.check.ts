import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT, type Fence, fencesIn, lineOf, prose } from './markdown.js';

/**
 * The lines that connect an agent are run, not read.
 *
 * A reader with a git repository and no `variance.config.json` gets one page
 * that prints what to install, what to run and what to put in an MCP client's
 * server list. Each of those failed for a different reason before it was
 * printed: `variance serve` and `variance doctor` exit 2 with no config, and a
 * client launches a `command` from its own PATH, where a local install puts
 * nothing. So this follows the page: its `npx variance` lines in a fresh
 * repository with no config, then its server entry as a client would launch it,
 * and asks for the tools and the code map. Only the install line stands in, as
 * links to the packages built here, and the page's confirmation, which fetches
 * a client from the registry.
 */

const PAGE = 'docs/agent-workspace-api.md';
const HEADING = '## Connect your agent';

/** Records of what happened, and what is not built, which quote the old wording rather than ask anything of a reader. */
const HISTORY = /^(?:docs\/context\/|docs\/specs\/|backlog\/)/;

const made: string[] = [];

afterAll(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** The fenced blocks of the section that prints the lines, or none when the page has no such section. */
function printed(): readonly Fence[] {
  const lines = prose(PAGE).split('\n');
  const start = lines.indexOf(HEADING);
  if (start === -1) return [];
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return fencesIn(PAGE).filter((fence) => fence.line > start && fence.line <= next);
}

const shellLines = (fences: readonly Fence[]): readonly string[] =>
  fences.filter((fence) => fence.lang === 'bash').flatMap((fence) => fence.code.trim().split('\n'));

/** A git repository of two packages with no variance config, the packages built here standing in for the install. */
function repository(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-agent-install-')));
  made.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const manifest = (name: string, more: object) =>
    `${JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './src/index.ts', ...more })}\n`;
  write('package.json', '{"name":"shop","private":true,"type":"module","workspaces":["packages/*"]}\n');
  write('packages/price/package.json', manifest('@shop/price', {}));
  write('packages/price/src/index.ts', 'export const price = (net: number) => net * 1.2;\n');
  write('packages/cart/package.json', manifest('@shop/cart', { dependencies: { '@shop/price': '1.0.0' } }));
  write('packages/cart/src/index.ts', "import { price } from '@shop/price';\nexport const total = price(1);\n");
  write('.gitignore', 'node_modules\n');
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@variance-authority'));
  for (const [name, bin] of [
    ['cli', 'variance'],
    ['help', 'variance-authority-help'],
  ] as const) {
    symlinkSync(join(ROOT, 'packages', name), join(root, 'node_modules/@variance-authority', name));
    // A shell script for `npm install`'s link and mode: the build leaves `dist/bin.js` unexecutable.
    write(`node_modules/.bin/${bin}`, `#!/bin/sh\nexec node "${join(ROOT, 'packages', name, 'dist/bin.js')}" "$@"\n`);
    chmodSync(join(root, 'node_modules/.bin', bin), 0o755);
  }
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=reader', '-c', 'user.email=reader@example.com', 'commit', '-qm', 'init'], {
    cwd: root,
  });
  return root;
}

interface Entry {
  readonly command: string;
  readonly args: readonly string[];
}

interface Followed {
  readonly lines: readonly { readonly line: string; readonly status: number | null; readonly out: string }[];
  readonly tools: readonly string[];
  readonly map: string;
}

/** Launch the entry the way a client does, from the repository, and ask it over stdio. */
async function connect(entry: Entry, cwd: string): Promise<Pick<Followed, 'tools' | 'map'>> {
  const server = spawn(entry.command, entry.args, { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = createInterface({ input: server.stdout })[Symbol.asyncIterator]();
  const send = (message: object) => server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const ask = async (id: number, method: string, params: object) => {
    send({ id, method, params });
    for (;;) {
      const { done, value } = await replies.next();
      if (done === true) throw new Error(`the server closed before it answered ${method}`);
      const reply = JSON.parse(value) as { id?: number; result?: unknown };
      if (reply.id === id) return reply.result;
    }
  };
  try {
    await ask(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'docs-agent-install', version: '0' },
    });
    send({ method: 'notifications/initialized' });
    const listed = (await ask(2, 'tools/list', {})) as { tools: readonly { name: string }[] };
    const called = (await ask(3, 'tools/call', { name: 'docs_orient', arguments: {} })) as {
      content: readonly { text: string }[];
    };
    return { tools: listed.tools.map((tool) => tool.name), map: called.content.map((part) => part.text).join('\n') };
  } finally {
    server.kill();
  }
}

/** Every `npx variance` line in the order the page prints them, then the printed server entry. */
async function follow(fences: readonly Fence[]): Promise<Followed> {
  const root = repository();
  const lines = shellLines(fences)
    .filter((line) => line.startsWith('npx variance '))
    .map((line) => {
      const run = spawnSync('sh', ['-c', line], { cwd: root, encoding: 'utf8' });
      return { line, status: run.status, out: run.stdout + run.stderr };
    });
  const list = JSON.parse(fences.find((fence) => fence.lang === 'json')?.code ?? '{}') as {
    mcpServers: Readonly<Record<string, Entry>>;
  };
  const [entry] = Object.values(list.mcpServers);
  if (entry === undefined) throw new Error(`${PAGE} prints no server entry under ${HEADING}`);
  return { lines, ...(await connect(entry, root)) };
}

const fences = printed();
// Awaited here rather than in a test: the run takes what the machine gives it, and no test timeout should judge that.
const followed = fences.length === 0 ? undefined : await follow(fences);

describe(`${PAGE} connects an agent with no variance config`, () => {
  it('prints the install, the index and the check that the tools are listed', () => {
    expect(shellLines(fences)).toEqual(
      expect.arrayContaining([
        'npm install --save-dev @variance-authority/cli @variance-authority/help',
        'npx variance index',
        expect.stringContaining('--method tools/list'),
      ]),
    );
  });

  it('every command it prints exits 0 where no config exists', () => {
    expect(followed?.lines.filter((run) => run.status !== 0)).toEqual([]);
  });

  it('its entry serves the tools, each named on the page', () => {
    const page = fences.map((fence) => fence.code).join('\n');
    expect(followed?.tools).toContain('docs_orient');
    expect(followed?.tools.filter((tool) => !page.includes(tool))).toEqual([]);
  });

  it('docs_orient returns the code map', () => {
    expect(followed?.map).toContain('2 packages in 2 dependency layers');
  });

  it('names no command that exits 2 without a config, unless the paragraph says it needs one', () => {
    const paragraphs = prose(PAGE).split(/\n\s*\n/);
    const unqualified = paragraphs.filter(
      (paragraph) => /variance (?:serve|doctor)/.test(paragraph) && !paragraph.includes('variance.config.json'),
    );
    expect(unqualified).toEqual([]);
  });
});

describe('an MCP client launches what a local install left', () => {
  // A client starts `command` from its own PATH, and `npm install` puts our bins in `node_modules/.bin`.
  it.each(MARKDOWN.filter((file) => !HISTORY.test(file)))('%s', (file) => {
    const text = fencesIn(file)
      .map((fence) => fence.code)
      .join('\n');
    const bare = [...text.matchAll(/"command":\s*"variance[\w-]*"/g)].map(
      (match) => `${file}:${lineOf(text, match.index)} → ${match[0]}`,
    );
    expect(bare).toEqual([]);
  });
});
