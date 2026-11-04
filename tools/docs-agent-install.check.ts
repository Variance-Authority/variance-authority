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
 * Each failed for a different reason before it was printed: `variance serve` and
 * `variance doctor` exit 2 with no config, and a client launches a `command` from
 * its own PATH, where a local install puts nothing. So this follows each page as
 * a reader would, in a fresh repository with no config.
 */

const PAGE = 'docs/agent-workspace-api.md';
const HEADING = '## Connect your agent';

/** Both entries of each are launched: one from the repository, one from `/`, where a client that names no directory can start a server. */
const RUN_PAGE = 'docs/agent-mcp.md';
const RUN_SERVER = '## Serve the report to a client';
const LIVE_PAGE = 'docs/agent-live-run.md';
const LIVE_SERVER = '## Start the watcher before the suite';

/** The least a report can hold: the server reads it as it starts and refuses anything else. */
const RUN_REPORT = {
  runVersion: 1,
  at: '2026-08-01T10:00:00.000Z',
  identity: { renderer: 'playwright-chromium', engine: 'chromium@131.0.0', platform: 'darwin/arm64', fonts: [] },
  retention: 'ephemeral',
  notObserved: [],
  observations: [],
};

/** Records of what happened, and what is not built, which quote the old wording rather than ask anything of a reader. */
const HISTORY = /^(?:docs\/context\/|docs\/specs\/|backlog\/)/;

/** The lines a reader runs that this cannot: each reaches the registry, for us, for the published package or for a client. */
const STANDS_IN = /^npm install |^npx @variance-authority\/help |@modelcontextprotocol\/inspector/;

const ORIENT = 'npx variance ask orient';
const SYMBOL = 'npx variance ask symbol --name price';

const made: string[] = [];

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
async function connect(entry: Entry, cwd: string, tool: string): Promise<Pick<Followed, 'tools' | 'answer'>> {
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
    const called = (await ask(3, 'tools/call', { name: tool, arguments: {} })) as {
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
      const run = spawnSync('sh', ['-c', line], { cwd: root, encoding: 'utf8' });
      return { line, status: run.status, out: run.stdout, said: run.stderr };
    });
  const [entry] = entriesIn(fences);
  if (entry === undefined) throw new Error(`${PAGE} prints no server entry under ${HEADING}`);
  return { lines, ...(await connect(entry, root, 'docs_orient')) };
}

const fences = printed(PAGE, HEADING);
// Awaited here rather than in a test: the run takes what the machine gives it, and no test timeout should judge that.
const followed = fences.length === 0 ? undefined : await follow(fences, 'several packages');
const alone = fences.length === 0 ? undefined : await follow(fences, 'one package');

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
        'npx variance index',
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
    expect(told.join('\n')).toContain('npx variance ask uses');
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

/** The entry for a client that names no directory, with the page's placeholder filled in as a reader fills it. */
const filledIn = (entry: Entry, root: string): Entry => ({
  command: entry.command,
  args: entry.args.map((arg) => arg.replace('/path/to/repo', root)),
});

/** Both of a section's entries launched over a finished report, which a watcher ignores. */
async function launched(page: string, heading: string, tool: string) {
  const root = repository('one package');
  mkdirSync(join(root, '.variance'));
  writeFileSync(join(root, '.variance/report.json'), JSON.stringify(RUN_REPORT));
  const [inside, outside] = entriesIn(printed(page, heading));
  return {
    page,
    tool,
    inside: inside === undefined ? undefined : await connect(inside, root, tool),
    outside: outside === undefined ? undefined : await connect(filledIn(outside, root), '/', tool),
  };
}

// Awaited here for the reason `followed` is: no test timeout should judge what the machine gives a launch.
const launches = [
  await launched(RUN_PAGE, RUN_SERVER, 'variance_summary'),
  await launched(LIVE_PAGE, LIVE_SERVER, 'variance_self'),
];

describe.each(launches)('$page launches from the repository and from anywhere else', ({ tool, inside, outside }) => {
  it('either entry serves the same tools', () => {
    expect(inside?.tools).toContain(tool);
    expect(outside?.tools).toEqual(inside?.tools);
  });
});

describe(`${RUN_PAGE} confirms the tools are listed`, () => {
  const section = printed(RUN_PAGE, RUN_SERVER);

  it('names every tool the entry serves', () => {
    const page = section.map((fence) => fence.code).join('\n');
    expect(launches[0]?.inside?.tools.filter((tool) => !page.includes(tool))).toEqual([]);
  });

  it('checks each entry from where its client starts, or a wrong entry passes in the repository', () => {
    const [inside, outside] = shellLines(section).filter((line) => line.includes('--method tools/list'));
    expect(inside).toContain('--config .mcp.json');
    expect(outside).toMatch(/^cd \/ && .*--config "[^"]*claude_desktop_config\.json"/);
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
