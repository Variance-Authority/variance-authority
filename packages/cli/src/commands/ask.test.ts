import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { VantageState } from '@variance-authority/vantage';
import type { VantageReading } from '@variance-authority/vantage/attach';
import { TOOLS, VANTAGE_TOOLS, toolByName, vantageToolByName } from '@variance-authority/mcp/tools';
import { ASKED, ask, questions } from './ask.js';
import { questionOf } from './asking.js';
import type { CliRunReport } from './run.js';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/sha256-abc'],
};

const REPORT: CliRunReport = {
  runVersion: 1,
  at: '2026-08-01T10:00:00.000Z',
  identity: IDENTITY,
  retention: 'durable',
  observations: [
    {
      subject: 'story:toggle',
      verdict: 'changed',
      because: '86 pixel(s) differ across 1 region(s) in Toggle',
      changedPixels: 86,
      regions: [
        {
          x: 4,
          y: 4,
          width: 16,
          height: 16,
          pixels: 86,
          component: 'Toggle',
          where: 'main → list item 2 of 3',
          file: 'src/ds/components.tsx:107',
          cause: true,
        },
      ],
    },
  ],
};

async function directory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'variance-ask-'));
}

function asking(
  path: string,
  question: string,
  rest: Record<string, unknown> = {},
): Parameters<typeof ask>[0] {
  return { question, report: path, read: () => Promise.resolve(REPORT), ...rest };
}

/** The questions listed under one heading, in the order they are printed. */
function listed(heading: string): readonly string[] {
  const lines = questions().split('\n');
  const from = lines.indexOf(heading);
  const rest = lines.slice(from + 1).join('\n').split(/^[A-Z ]+$/m)[0]!;

  return rest.split('\n').flatMap((line) => /^([a-z][a-z-]*)(?: |$)/.exec(line)?.[1] ?? []);
}

describe('the questions', () => {
  it('offers every tool an MCP client is offered, and invents none', () => {
    // The whole claim of this command: an agent that cannot host a server is not
    // holding a smaller product. A tool added to either MCP set and not to this
    // list would make that false silently, in the one direction nobody checks.
    expect(listed('ABOUT THE LAST RUN')).toEqual(TOOLS.map(questionOf));
    expect(listed('ABOUT A SUITE THAT IS STILL RUNNING')).toEqual(VANTAGE_TOOLS.map(questionOf));
  });

  it('lists the question that is both under both, because it answers about both', () => {
    // `diff` is one function over either subject. Printing it once would make a
    // reader in the half it was left out of believe it cannot be asked there.
    expect(listed('ABOUT THE LAST RUN')).toContain('diff');
    expect(listed('ABOUT A SUITE THAT IS STILL RUNNING')).toContain('diff');
  });

  it('names each question after its tool, without the transport in the name', () => {
    expect(questionOf(toolByName('variance_trace_component')!)).toBe('trace-component');
  });

  it('answers without a report, because nothing about a run decides what may be asked', () => {
    expect(questions()).toContain('summary');
  });
});

describe('an answer', () => {
  it('is the tool’s own answer, unedited', async () => {
    // Not "the same information". The same string, from the same function: two
    // renderings of one report is how a person and an agent end up describing
    // different runs to each other.
    const path = join(await directory(), 'report.json');
    const expected = toolByName('variance_summary')!.run(REPORT, {});

    expect(await ask(asking(path, 'summary'))).toBe(`${expected}\n`);
  });

  it('passes a flag through as the argument the tool declares', async () => {
    const path = join(await directory(), 'report.json');
    const expected = toolByName('variance_describe')!.run(REPORT, { subject: 'story:toggle' });

    expect(await ask(asking(path, 'describe', { subject: 'story:toggle' }))).toBe(`${expected}\n`);
  });

  it('refuses a flag the question has no argument for, and names the ones it takes', async () => {
    // Ignoring it would answer about the whole suite while the operator reads
    // their own shell history and sees the subject they asked about.
    const path = join(await directory(), 'report.json');

    await expect(ask(asking(path, 'summary', { subject: 'story:toggle' }))).rejects.toThrow(
      '`--subject` is not an argument `variance ask summary` takes; it takes none',
    );
    await expect(ask(asking(path, 'findings', { component: 'Toggle' }))).rejects.toThrow(
      'it takes --rule',
    );
  });

  it('refuses a missing required argument before it reads anything', async () => {
    const path = join(await directory(), 'report.json');
    const request = {
      ...asking(path, 'describe'),
      read: () => Promise.reject(new Error('the report was read')),
    };

    await expect(ask(request)).rejects.toThrow('`variance ask describe` needs --subject');
  });

  it('refuses an unknown question by listing the ones that exist', async () => {
    const path = join(await directory(), 'report.json');

    await expect(ask(asking(path, 'summarise'))).rejects.toThrow(
      '`summarise` is not a question; there is summary,',
    );
  });
});

describe('the state `diff` compares against', () => {
  it('survives the process, which is the whole difference from a connection', async () => {
    // An MCP server holds the previous subject in memory because it is one
    // process for as long as the agent is asking. A command line is not, so the
    // same tool would answer "first invocation" forever.
    const path = join(await directory(), 'report.json');

    expect(await ask(asking(path, 'diff'))).toContain('No previous invocation was recorded');
    expect(await ask(asking(path, 'diff'))).toContain('matches the previous invocation');

    const moved = { ...REPORT, at: '2026-08-02T10:00:00.000Z' };
    const answer = await ask({ ...asking(path, 'diff'), read: () => Promise.resolve(moved) });

    expect(answer).toContain('~ $.at:');
  });

  it('is replaced by any successful answer, as a connection replaces it', async () => {
    const path = join(await directory(), 'report.json');
    await ask(asking(path, 'summary'));

    expect(await ask(asking(path, 'diff'))).toContain('matches the previous invocation');
  });

  it('is not replaced by a refusal', async () => {
    // The rule that makes the answer mean something: a call that failed must not
    // become the run a later diff reports no change against.
    const path = join(await directory(), 'report.json');
    await ask(asking(path, 'summary'));
    await expect(ask(asking(path, 'describe'))).rejects.toThrow('needs --subject');

    const recorded = JSON.parse(await readFile(join(path, '..', ASKED), 'utf8')) as CliRunReport;
    expect(recorded.at).toBe(REPORT.at);
  });

  it('treats an unreadable record as no record rather than refusing the question', async () => {
    // It is a derived file in the run's output directory, reproducible by asking
    // again. Withholding the report over it would be the wrong thing to protect.
    const where = await directory();
    await writeFile(join(where, ASKED), 'not json', 'utf8');

    expect(await ask(asking(join(where, 'report.json'), 'diff'))).toContain(
      'No previous invocation was recorded',
    );
  });
});

const RUNNING: VantageState = {
  address: 'http://127.0.0.1:4100',
  tests: [
    {
      id: 't-1',
      title: 'cart adds an item',
      file: 'cart.spec.ts',
      worker: 0,
      ordinal: 0,
      state: 'passed',
      heard: [],
      forgotten: 0,
      pending: [],
      remarks: [],
    },
  ],
  forgotten: 0,
};

function about(question: string, reading: VantageReading, rest: Record<string, unknown> = {}) {
  return {
    ...asking('/nowhere/report.json', question, rest),
    at: 'http://127.0.0.1:4100',
    look: () => Promise.resolve(reading),
    read: () => Promise.reject(new Error('the report was read')),
  };
}

describe('a question about a suite that is still running', () => {
  it('is the watcher’s own answer, from the same function a connection calls', async () => {
    // The parity claim again, on the half that has a process behind it: what an
    // agent reads over stdio and what it reads from a terminal is one string.
    const expected = vantageToolByName('variance_run_signals')!.run(RUNNING, {});

    expect(await ask(about('run-signals', { state: RUNNING }))).toBe(`${expected}\n`);
  });

  it('reads the run without touching the report, which may not exist at all', async () => {
    // A watcher is asked while the suite is going. There is no report yet, and
    // falling back to one would answer about the run before this one.
    expect(await ask(about('self', { state: RUNNING }))).toContain('http://127.0.0.1:4100');
  });

  it('compares against the reading the watcher handed out last', async () => {
    // The watcher holds it, because this process exits between questions and has
    // nothing to hold. Same bargain one connection makes for its one client.
    const moved: VantageState = { ...RUNNING, forgotten: 3 };

    expect(await ask(about('diff', { state: moved, previous: RUNNING }))).toContain(
      '~ $.forgotten:',
    );
    expect(await ask(about('diff', { state: RUNNING }))).toContain(
      'No previous invocation was recorded',
    );
  });

  it('records nothing, because a watcher is not a run that finished', async () => {
    // `ASKED` is the report path's state. Writing it here would leave the next
    // report `diff` comparing against a suite that was still running.
    const where = await directory();
    await ask({
      ...about('run-signals', { state: RUNNING }),
      report: join(where, 'report.json'),
    });

    await expect(readFile(join(where, ASKED), 'utf8')).rejects.toThrow('ENOENT');
  });

  it('refuses a live question with no watcher, and says what to start', async () => {
    // Nothing about the name `run-signals` says it needs a process started before
    // the suite was. Being told is the whole of the help.
    const path = join(await directory(), 'report.json');

    await expect(ask(asking(path, 'run-signals'))).rejects.toThrow(
      'is about a suite that is still running, and needs a watcher to ask',
    );
  });

  it('answers a report question from the report even when a watcher is reachable', async () => {
    // `VARIANCE_AUTHORITY_VANTAGE` is exported for the whole shell while a suite
    // runs. If that turned `summary` into a refusal, setting it once would break
    // every other question in the session.
    const path = join(await directory(), 'report.json');
    const expected = toolByName('variance_summary')!.run(REPORT, {});

    expect(
      await ask({ ...asking(path, 'summary'), at: 'http://127.0.0.1:4100', look: () => Promise.reject(new Error('asked the watcher')) }),
    ).toBe(`${expected}\n`);
  });
});
