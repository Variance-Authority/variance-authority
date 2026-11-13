import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT, type Fence, fencesIn, lineOf, prose } from './markdown.js';

/**
 * The lines that connect an agent are run, not read.
 *
 * Each failed for a different reason before it was printed: `variance serve` and
 * `variance doctor` exit 2 with no config, and a client launches a `command` from
 * its own PATH, where a local install puts nothing. So this follows the page as a
 * reader would, in a fresh repository with no config.
 */

const PAGE = 'docs/agent-workspace-api.md';
const HEADING = '## Connect your agent';

/** Records of what happened, and what is not built, which quote the old wording rather than ask anything of a reader. */
const HISTORY = /^(?:docs\/context\/|docs\/specs\/|backlog\/)/;

/** The lines a reader runs that this cannot: each reaches the registry, for us or for a client. */
const STANDS_IN = /^npm install |@modelcontextprotocol\/inspector/;

const ORIENT = 'variance ask orient';
const SYMBOL = 'variance ask symbol --name price';

const made: string[] = [];

/** What a package manager does for a reader: their `node_modules/.bin` leads the PATH, so the bare command finds the install. */
const asInstalled = (root: string): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${join(root, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
});

afterAll(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** The fenced blocks of a section, or none when the page has no such section. */
function printed(page: string, heading: string): readonly Fence[] {
  const lines = prose(page).split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return fencesIn(page).filter((fence) => fence.line > start && fence.line <= next);
}

const shellLines = (fences: readonly Fence[]): readonly string[] =>
  fences.filter((fence) => fence.lang === 'bash').flatMap((fence) => fence.code.trim().split('\n'));

const manifest = (name: string, more: object) =>
  `${JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './src/index.ts', ...more })}\n`;

/** The two shapes a reader's repository takes, whose answers differ. */
const SHAPES = {
  'several packages': {
    'package.json': '{"name":"shop","private":true,"type":"module","workspaces":["packages/*"]}\n',
    'packages/price/package.json': manifest('@shop/price', {}),
    'packages/price/src/index.ts': 'export const price = (net: number) => net * 1.2;\n',
    'packages/cart/package.json': manifest('@shop/cart', { dependencies: { '@shop/price': '1.0.0' } }),
    'packages/cart/src/index.ts': "import { price } from '@shop/price';\nexport const total = price(1);\n",
  },
  'one package': {
    'package.json': manifest('shop', {}),
    'src/index.ts': 'export const price = (net: number) => net * 1.2;\n',
  },
} as const;

type Shape = keyof typeof SHAPES;

/** A git repository with no variance config, the packages built here standing in for the install. */
function repository(shape: Shape): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-agent-install-')));
  made.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(SHAPES[shape])) write(path, text);
  write('.gitignore', 'node_modules\n');
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@variance-authority'));
  for (const [name, bin] of [
    ['cli', 'variance'],
    ['help', 'variance-authority-help'],
    ['mcp', 'variance-authority-mcp'],
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
  /** `out` is the answer; `said` is what a command says while it works, such as what it waits for, which the load decides. */
  readonly lines: readonly {
    readonly line: string;
    readonly status: number | null;
    readonly out: string;
    readonly said: string;
  }[];
  readonly tools: readonly string[];
  readonly answer: string;
}

/** Launch the entry the way a client does, from the repository, and ask it over stdio. */
async function connect(entry: Entry, cwd: string): Promise<Pick<Followed, 'tools' | 'answer'>> {
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
    return {
      tools: listed.tools.map(({ name }) => name),
      answer: called.content.map((part) => part.text).join('\n'),
    };
  } finally {
    server.kill();
  }
}

/** The server entries a section prints, in its order. */
const entriesIn = (section: readonly Fence[]): readonly Entry[] =>
  section
    .filter((fence) => fence.lang === 'json')
    .flatMap((fence) => Object.values((JSON.parse(fence.code) as { mcpServers: Record<string, Entry> }).mcpServers));

/** Every shell line in the order the page prints them, then the printed server entry. */
async function follow(fences: readonly Fence[], shape: Shape): Promise<Followed> {
  const root = repository(shape);
  const lines = shellLines(fences)
    .filter((line) => !STANDS_IN.test(line))
    .map((line) => {
      const run = spawnSync('sh', ['-c', line], { cwd: root, encoding: 'utf8', env: asInstalled(root) });
      return { line, status: run.status, out: run.stdout, said: run.stderr };
    });
  const [entry] = entriesIn(fences);
  if (entry === undefined) throw new Error(`${PAGE} prints no server entry under ${HEADING}`);
  return { lines, ...(await connect(entry, root)) };
}

/** The pages that print the Inspector, and the version they print: 2 needs Node 22.19, above what our packages declare. */
const INSPECTED = [PAGE, 'packages/cli/skills/variance-authority/references/mcp.md'];
const INSPECTOR = '@modelcontextprotocol/inspector@1 ';
const USES = 'variance ask uses --name price';

/** What `ask uses` prints for a name, as indexed, after a file came to import it, and after `variance index`. */
function editedUse(): { readonly indexed: string; readonly reused: string; readonly reindexed: string } {
  const root = repository('one package');
  const sh = (line: string) => spawnSync('sh', ['-c', line], { cwd: root, encoding: 'utf8', env: asInstalled(root) }).stdout;
  sh('variance index');
  const indexed = sh(USES);
  writeFileSync(join(root, 'src/use.ts'), "import { price } from './index.js';\nexport const total = price(1);\n");
  const reused = sh(USES);
  sh('variance index');
  return { indexed, reused, reindexed: sh(USES) };
}

const fences = printed(PAGE, HEADING);
// Awaited here rather than in a test: the run takes what the machine gives it, and no test timeout should judge that.
const followed = fences.length === 0 ? undefined : await follow(fences, 'several packages');
const alone = fences.length === 0 ? undefined : await follow(fences, 'one package');
const edited = editedUse();

/** An answer as the page prints it: a reader's index and repository are named for where they are, and the page cannot say. */
const asPrinted = (answer: string | undefined): string =>
  (answer ?? '')
    .trim()
    .replace(/\S+\/source-index\.bin/g, '…/source-index.bin')
    .replace(/^# [^:]+:/, '# shop:');

const answerTo = (asked: string, run: Followed | undefined): string =>
  asPrinted(run?.lines.find(({ line }) => line === asked)?.out);

const orientOf = (run: Followed | undefined): string => answerTo(ORIENT, run);

/** What a name is and who uses it, the lines above its signature, which the page prints. */
const symbolOf = (run: Followed | undefined): string => answerTo(SYMBOL, run).split('\n\n')[0] ?? '';

const printedAnswers = fences
  .filter((fence) => fence.lang === 'text')
  .map((fence) => fence.code)
  .join('\n');

describe(`${PAGE} connects an agent with no variance config`, () => {
  it('prints the install, the index, the check that the tools are listed and the skill link', () => {
    expect(shellLines(fences)).toEqual(
      expect.arrayContaining([
        'npm install --save-dev @variance-authority/cli @variance-authority/help',
        'variance index',
        expect.stringContaining('--method tools/list'),
        expect.stringContaining('ln -s ../../node_modules/@variance-authority/cli/skills/variance-authority'),
      ]),
    );
  });

  it('every command it prints exits 0 where no config exists', () => {
    expect(followed?.lines.filter((run) => run.status !== 0)).toEqual([]);
    expect(alone?.lines.filter((run) => run.status !== 0)).toEqual([]);
  });

  it('tells the agent the questions exist before the section ends', () => {
    const told = fences.filter((fence) => fence.lang === 'markdown').map((fence) => fence.code);
    expect(told.join('\n')).toContain('variance ask uses');
  });

  it('prints the answer each shape of repository gets', () => {
    expect(orientOf(followed)).toContain('2 packages in 2 dependency layers');
    expect(orientOf(alone)).toContain('folded into no code map');
    expect(printedAnswers).toContain(orientOf(followed));
    expect(printedAnswers).toContain(orientOf(alone));
  });

  it('its entry serves the tools, each named on the page', () => {
    const page = fences.map((fence) => fence.code).join('\n');
    expect(followed?.tools).toContain('docs_orient');
    expect(followed?.tools.filter((tool) => !page.includes(tool))).toEqual([]);
  });

  it('a question about a name answers in either shape, and the page prints the answer', () => {
    expect(symbolOf(followed)).toContain('declared at packages/price/src/index.ts:1');
    expect(symbolOf(alone)).toContain('declared at src/index.ts:1');
    expect(printedAnswers).toContain(symbolOf(followed));
  });

  it('docs_orient returns what the shell printed', () => {
    expect(asPrinted(followed?.answer)).toContain(orientOf(followed));
    expect(asPrinted(alone?.answer)).toContain(orientOf(alone));
  });

  it('a use of a name the index holds waits for `variance index`, as the page says', () => {
    expect(edited.reused).toBe(edited.indexed);
    expect(edited.reindexed).toContain('src/use.ts');
    expect(prose(PAGE)).toContain('Run `variance index` when');
  });

  // The run keeps the old signature and restarts the hour, and the page says so.
  it.todo('a changed signature is answered after `variance index` — needs the publish to read the files the run read again (#953)');

  it.each(INSPECTED)('%s prints the Inspector every supported Node runs', (page) => {
    const named = readFileSync(join(ROOT, page), 'utf8').match(/@modelcontextprotocol\/inspector\S* /g);
    expect(named).toEqual([INSPECTOR]);
  });

  it.each([PAGE, 'docs/agent-cli.md'])(
    '%s names no command that exits 2 without a config, unless the paragraph says it needs one',
    (page) => {
      const paragraphs = prose(page).split(/\n\s*\n/);
      const unqualified = paragraphs.filter(
        (paragraph) => /variance (?:serve|doctor)/.test(paragraph) && !paragraph.includes('variance.config.json'),
      );
      expect(unqualified).toEqual([]);
    },
  );
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
