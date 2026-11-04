import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { type Shape, printed, repository, shellLines } from './docs-agent-repository.js';
import { MARKDOWN, type Fence, fencesIn, lineOf, prose } from './markdown.js';

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

/** Both of its entries are launched: one from the repository, one from `/`, where a client that names no directory can start a server. */
const RUN_PAGE = 'docs/agent-mcp.md';
const RUN_SERVER = '## Serve the report to a client';
const RUN_QUESTIONS = '## Ask from the run outward';

const LIVE_PAGE = 'docs/agent-live-run.md';
const LIVE_SERVER = '## Start the watcher before the suite';

/** Its doctor lines are read off a real link, a stale copy and a miss, the three things a reader can find there. */
const SKILLS_PAGE = 'docs/agent-cli.md';
const SKILLS = '## Link the skills into your agent';

/** A report as `variance run` leaves it, which states what it did not observe. */
const RUN_REPORT = {
  runVersion: 1,
  at: '2026-08-01T10:00:00.000Z',
  identity: {
    renderer: 'playwright-chromium',
    engine: 'chromium@131.0.0',
    platform: 'darwin/arm64',
    deviceScaleFactor: 1,
    fonts: ['Inter/400/normal/abc'],
  },
  retention: 'ephemeral',
  notObserved: [],
  observations: [
    {
      subject: 'checkout/empty',
      verdict: 'changed',
      because: '1530 pixel(s) differ across 1 region(s) in Toggle',
      changedPixels: 1530,
      regions: [],
    },
    { subject: 'checkout/filled', verdict: 'unchanged', because: 'no pixels differ', changedPixels: 0, regions: [] },
  ],
};

/** Records of what happened, and what is not built, which quote the old wording rather than ask anything of a reader. */
const HISTORY = /^(?:docs\/context\/|docs\/specs\/|backlog\/)/;

/** The lines a reader runs that this cannot: each reaches the registry, for us, for the published package or for a client. */
const STANDS_IN = /^npm install |^npx @variance-authority\/help |@modelcontextprotocol\/inspector/;

const ORIENT = 'npx variance ask orient';
const SYMBOL = 'npx variance ask symbol --name price';

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
        'npm install --save-dev @variance-authority/cli',
        'npm install --save-dev @variance-authority/help',
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

  it('names no command that exits 2 without a config, unless the paragraph says it needs one', () => {
    const paragraphs = prose(PAGE).split(/\n\s*\n/);
    const unqualified = paragraphs.filter(
      (paragraph) => /variance (?:serve|doctor)/.test(paragraph) && !paragraph.includes('variance.config.json'),
    );
    expect(unqualified).toEqual([]);
  });
});

describe('README.md starts an agent on the lines the page runs', () => {
  const start = printed('README.md', '## Connect your coding agent');

  it('prints the install, the index and the check, each of them run above', () => {
    expect(shellLines(start)).toContain(SYMBOL);
    expect(shellLines(fences)).toEqual(expect.arrayContaining([...shellLines(start)]));
  });

  it('prints the answer that check gets', () => {
    const [answer] = start.filter((fence) => fence.lang === 'text');
    expect(answer?.code.trim()).toBe(symbolOf(followed));
  });
});

const runServer = printed(RUN_PAGE, RUN_SERVER);
const runAnswers = printed(RUN_PAGE, RUN_QUESTIONS)
  .filter((fence) => fence.lang === 'text')
  .map((fence) => fence.code)
  .join('\n');

/** A repository holding a finished run, and `report` written where the printed entries look for it. */
function runRepository(report: string | undefined): string {
  const root = repository('one package');
  if (report !== undefined) {
    mkdirSync(join(root, '.variance'));
    writeFileSync(join(root, '.variance/report.json'), report);
  }
  return root;
}

const inTheRepository = entriesIn(runServer)[0];
const fromAnywhere = entriesIn(runServer)[1];

/** The entry for a client that names no directory, with the page's placeholder filled in as a reader fills it. */
const filledIn = (entry: Entry, root: string): Entry => ({
  command: entry.command,
  args: entry.args.map((arg) => arg.replace('/path/to/repo', root)),
});

const served = JSON.stringify(RUN_REPORT);
// Awaited here for the reason `followed` is: no test timeout should judge what the machine gives a launch.
const started =
  inTheRepository === undefined
    ? undefined
    : await connect(inTheRepository, runRepository(served), 'variance_summary');
const startedElsewhere =
  fromAnywhere === undefined
    ? undefined
    : await connect(filledIn(fromAnywhere, runRepository(served)), '/', 'variance_summary');
const firstDiff =
  inTheRepository === undefined ? undefined : await connect(inTheRepository, runRepository(served), 'variance_diff');

/** What a client's log holds when the first entry is launched over `report`. */
const failure = (report: string | undefined): string =>
  inTheRepository === undefined
    ? ''
    : spawnSync(inTheRepository.command, inTheRepository.args, {
        cwd: runRepository(report),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).stderr;

describe(`${RUN_PAGE} connects a client to a finished run`, () => {
  it('prints an entry for a client in the repository and one for a client anywhere else', () => {
    expect(entriesIn(runServer)).toHaveLength(2);
  });

  it('either entry serves the tools the page names', () => {
    const page = runServer.map((fence) => fence.code).join('\n');
    expect(started?.tools).toContain('variance_summary');
    expect(startedElsewhere?.tools).toEqual(started?.tools);
    expect(started?.tools.filter((tool) => !page.includes(tool))).toEqual([]);
  });

  it('either entry returns the answer the page prints for the first call', () => {
    expect(startedElsewhere?.answer).toBe(started?.answer);
    expect(runAnswers).toContain(started?.answer.trim() ?? 'no answer');
  });

  it('checks each entry from where its client starts, or a wrong entry passes in the repository', () => {
    const [inside, outside] = shellLines(runServer).filter((line) => line.includes('--method tools/list'));
    expect(inside).toContain('--config .mcp.json');
    expect(outside).toMatch(/^cd \/ && .*--config "[^"]*claude_desktop_config\.json"/);
  });

  it('names what `variance_diff` answers with nothing kept', () => {
    expect(firstDiff?.answer).toContain('No previous invocation was recorded');
    expect(prose(RUN_PAGE)).toContain('No previous invocation was recorded');
  });

  it('names what a start that failed prints', () => {
    const page = prose(RUN_PAGE);
    expect(failure(undefined)).toContain("ENOENT: no such file or directory, open '.variance/report.json'");
    expect(page).toContain('ENOENT: no such file or directory');
    expect(failure('{}')).toContain('is not a variance-authority run report');
    expect(page).toContain('is not a variance-authority run report');
  });
});

const liveRoot = repository('one package');
const [liveEntry, livePrefixed] = entriesIn(printed(LIVE_PAGE, LIVE_SERVER));
const liveProse = prose(LIVE_PAGE);
const liveElsewhere = livePrefixed === undefined ? undefined : filledIn(livePrefixed, liveRoot);
const watching = liveEntry === undefined ? undefined : await connect(liveEntry, liveRoot, 'variance_self');
const watchingElsewhere = liveElsewhere === undefined ? undefined : await connect(liveElsewhere, '/', 'variance_self');

describe(`${LIVE_PAGE} connects a client to a run in flight`, () => {
  const answers = fencesIn(LIVE_PAGE).filter((fence) => fence.lang === 'text');

  it('the entry reads the assignment out of `variance_self`, as the page prints it', () => {
    const [opening, , assigning, , address] = (watching?.answer ?? '').split('\n');
    expect(address).toMatch(/^ {2}VARIANCE_AUTHORITY_VANTAGE=http:\/\/127\.0\.0\.1:\d+$/);
    expect(answers.some((fence) => fence.code.includes(`${opening}\n\n${assigning}`))).toBe(true);
  });

  it('the entry for a client elsewhere answers from `/`', () => {
    expect(watchingElsewhere?.answer).toContain('VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:');
  });

  it('names the config the shell questions load, which `variance watch` does not', () => {
    const asked = spawnSync('npx', ['variance', 'ask', 'self', '--at', 'http://127.0.0.1:9'], {
      cwd: liveRoot,
      encoding: 'utf8',
    });
    expect(asked.status).toBe(2);
    expect(liveProse).toContain('`--config <path>`');
  });

  it('names both halves an announcement needs: `vae` in the application and `events` in the test', () => {
    expect(liveProse).toContain('`vae`');
    expect(liveProse).toContain('`events` fixture');
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

describe(`${SKILLS_PAGE} links the skills and checks the links`, () => {
  const section = printed(SKILLS_PAGE, SKILLS);
  const lines = shellLines(section);
  const doctor = lines.find((line) => line.includes('variance doctor')) ?? '';
  const check = lines.find((line) => /\bls\b/.test(line)) ?? '';
  const samples = section.filter((fence) => fence.lang === 'text').map((fence) => fence.code.trim());
  const sh = (line: string, cwd: string, env: NodeJS.ProcessEnv = process.env) =>
    spawnSync('sh', ['-c', line], { cwd, encoding: 'utf8', env });
  const linked = () => {
    const root = repository('one package');
    for (const line of lines.filter((line) => line.includes('ln -s'))) expect(sh(line, root).status).toBe(0);
    return root;
  };

  it('prints a check that needs no config, and what it prints when a link is missing', () => {
    const root = repository('one package');
    expect(sh(check, root).stderr).toContain('No such file or directory');
    expect(prose(SKILLS_PAGE)).toContain('`No such file or directory`');
    const reached = sh(check, linked());
    expect(reached.stderr).toBe('');
    expect(samples).toContain(reached.stdout.trim());
  });

  it('prints the lines the doctor gives for a link, a stale copy and a miss', () => {
    const root = linked();
    const home = join(root, 'home');
    mkdirSync(home);
    rmSync(join(root, '.claude/skills/variance-authority'));
    mkdirSync(join(root, '.claude/skills/variance-authority'));
    writeFileSync(join(root, '.claude/skills/variance-authority/SKILL.md'), 'an old copy\n');
    for (const dir of ['.claude', '.agents']) rmSync(join(root, dir, 'skills/variance-testing'));
    writeFileSync(
      join(root, 'variance.config.json'),
      JSON.stringify({
        project: 'shop',
        profile: 'chromium',
        viewport: { width: 1280, height: 800 },
        retention: 'durable',
        subjects: { kind: 'list', ids: ['checkout/empty'], collector: 'variance/routes.mjs' },
        baselines: { kind: 'directory', root: '.variance/baselines' },
        fonts: [],
        report: '.variance/report.json',
      }),
    );
    const page = sh(doctor, root, { ...process.env, HOME: home }).stdout;
    // The packages built here stand in for the install, so where they sit is the one thing a reader's differs in.
    const answer = (/^skills: [\s\S]*?(?=\n\n)/m.exec(page)?.[0] ?? '').replace(
      /\S*packages\/cli\/skills/g,
      (_, at: number, text: string) =>
        text.lastIndexOf('ln -s', at) > text.lastIndexOf('\n', at)
          ? '../../node_modules/@variance-authority/cli/skills'
          : 'node_modules/@variance-authority/cli/skills',
    );
    expect(samples).toContain(answer);
  });
});
