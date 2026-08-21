import { PassThrough } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORTS, handle, createLineReader, PROTOCOL_VERSION } from './protocol.js';
import type { RunReport } from '@variance-authority/report';
import { readRunReport, writeRunReport } from '@variance-authority/report/file';
import { serve, serveReportFile } from './server.js';
import { TOOLS, toolByName } from './tools.js';

/**
 * The MCP surface, tested where the decisions are.
 *
 * Almost nothing here speaks a protocol, because almost nothing that matters is
 * about the protocol. What matters is whether an agent handed these answers can
 * act on them, and that is a question about text.
 */

const REPORT: RunReport = {
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
  intent: 'Rebrand: new accent, rounder corners',
  observations: [
    {
      subject: 'page/todos--populated',
      verdict: 'changed',
      because: '1530 pixel(s) differ across 5 region(s) in Toggle, Text',
      changedPixels: 1530,
      regions: [
        {
          x: 40,
          y: 120,
          width: 22,
          height: 22,
          pixels: 86,
          component: 'Toggle',
          where: 'main → list item 2 of 3',
          file: 'src/ds/components.tsx:107',
          cause: true,
        },
        {
          x: 70,
          y: 118,
          width: 180,
          height: 20,
          pixels: 511,
          component: 'Stack',
          file: 'src/ds/components.tsx:27',
          cause: false,
        },
      ],
      truncated: { regions: 3, pixels: 12 },
    },
    { subject: 'ds/button--primary', verdict: 'unchanged', because: 'no pixels differ', changedPixels: 0, regions: [] },
    { subject: 'ds/card--default', verdict: 'unchanged', because: 'no pixels differ', changedPixels: 0, regions: [] },
    {
      subject: 'page/todos--empty',
      verdict: 'incomparable',
      because:
        'a baseline for `page/todos--empty` exists but was rendered by playwright-chromium ' +
        '(chromium@131.0.0, linux/x64, 1x), and this run is playwright-chromium ' +
        '(chromium@131.0.0, darwin/arm64, 1x); pixels are machine-bound',
      changedPixels: 0,
      regions: [],
    },
  ],
};

function call(name: string, args: Record<string, unknown> = {}): string {
  const response = handle(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    () => REPORT,
    REPORTS,
  );
  const result = response!.result as { content: { text: string }[]; isError?: boolean };
  return result.content[0]!.text;
}

describe('the summary', () => {
  it('counts unchanged subjects instead of listing them', () => {
    // A run over 300 subjects where two changed should print two lines. A list
    // as long as the suite is the "100 changes? merge" failure in its purest
    // form — the reader stops before the interesting line.
    const text = call('variance_summary');

    expect(text).toContain('2 unchanged');
    expect(text).not.toContain('ds/button--primary');
    expect(text).toContain('page/todos--populated');
  });

  it('leads each line with the cause rather than the biggest region', () => {
    expect(call('variance_summary')).toContain('page/todos--populated — Toggle');
  });

  it('says which machine rendered it, because that decides comparability', () => {
    expect(call('variance_summary')).toContain('darwin/arm64');
  });

  it('says so plainly when nothing needs review', () => {
    // `notObserved: []` is what makes the claim available, and is not decoration:
    // a clean observation list only means a clean run for a report that also
    // accounted for the subjects it planned. See `scenario.test.ts` for the two
    // states this fixture is deliberately not in.
    const clean = handle(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'variance_summary' } },
      () => ({
        ...REPORT,
        observations: REPORT.observations.filter((o) => o.verdict === 'unchanged'),
        notObserved: [],
      }),
      REPORTS,
    );
    const text = (clean!.result as { content: { text: string }[] }).content[0]!.text;

    expect(text).toContain('nothing to review');
  });
});

describe('describing a subject', () => {
  it('gives the cause, the place, and the file, in that order', () => {
    const text = call('variance_describe', { subject: 'page/todos--populated' });
    const lines = text.split('\n');

    const cause = lines.findIndex((line) => line.includes('cause') && line.includes('Toggle'));
    const collateral = lines.findIndex((line) => line.includes('collateral'));

    expect(cause).toBeGreaterThan(-1);
    expect(cause).toBeLessThan(collateral);
    expect(text).toContain('in main → list item 2 of 3');
    expect(text).toContain('src/ds/components.tsx:107');
  });

  it('says what it left out rather than capping silently', () => {
    // A truncated list that does not say it was truncated reads as complete
    // coverage, and nothing in the output distinguishes the two.
    expect(call('variance_describe', { subject: 'page/todos--populated' })).toContain(
      '+3 smaller region(s) not listed (12px)',
    );
  });

  it('lists the alternatives when asked for a subject that is not there', () => {
    // An agent handed "unknown subject" guesses again. An agent handed the list
    // picks the right one.
    const text = call('variance_describe', { subject: 'page/typo' });

    expect(text).toContain('unknown subject');
    expect(text).toContain('page/todos--populated');
  });

  it('returns a tool failure as readable text, not as a transport error', () => {
    const response = handle(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'variance_describe', arguments: {} } },
      () => REPORT,
      REPORTS,
    );
    const result = response!.result as { isError?: boolean; content: { text: string }[] };

    expect(response!.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('`subject` is required');
  });
});

describe('findings, which no comparison could have produced', () => {
  /**
   * The property being asserted is that these survive a *clean* run. A subject
   * reported `unchanged` is a subject a comparison has nothing to say about, and
   * a control that never had an accessible name is `unchanged` on every run
   * there will ever be.
   */
  const WITH_FINDINGS: RunReport = {
    ...REPORT,
    observations: [
      {
        subject: 'ds/button--primary',
        verdict: 'unchanged',
        because: 'no pixels differ',
        changedPixels: 0,
        regions: [],
        findings: [
          {
            rule: 'control-without-name',
            what: '<button> is a button with no accessible name',
            path: '0/1',
            component: 'IconButton',
            file: 'src/ds/IconButton.tsx:12',
          },
        ],
      },
      {
        subject: 'ds/card--default',
        verdict: 'unchanged',
        because: 'no pixels differ',
        changedPixels: 0,
        regions: [],
        findings: [
          {
            rule: 'control-without-name',
            what: '<button> is a button with no accessible name',
            path: '0/3',
            component: 'IconButton',
            file: 'src/ds/IconButton.tsx:12',
          },
          {
            rule: 'heading-level-skipped',
            what: 'heading level jumps from 2 to 4 at "Billing"',
            path: '0/0',
            component: 'Card',
            file: 'src/ds/Card.tsx:8',
          },
        ],
      },
    ],
  };

  it('points at them from a summary that is otherwise clean', () => {
    const text = toolByName('variance_summary')!.run(WITH_FINDINGS, {});

    expect(text).toContain('2 unchanged');
    expect(text).toContain('findings: 3 in 2 subject(s)');
    expect(text).toContain('do not affect the verdict');
  });

  it('collapses one component in two subjects into one line', () => {
    const text = toolByName('variance_findings')!.run(WITH_FINDINGS, {});

    expect(text).toContain('control-without-name — 2 occurrence(s)');
    expect(text).toContain('src/ds/IconButton.tsx:12 — in 2 subjects');
    expect(text).toContain('heading-level-skipped');
  });

  it('filters to one rule when asked', () => {
    const text = toolByName('variance_findings')!.run(WITH_FINDINGS, { rule: 'heading-level-skipped' });

    expect(text).toContain('heading-level-skipped');
    expect(text).not.toContain('control-without-name');
  });

  /**
   * The same distinction `coverage` draws. A report with no findings and a
   * report written by something that never inspected anything are different
   * claims, and an agent told "no findings" over the second has been told the
   * renders are clean by something that never read them.
   */
  it('does not let "nothing inspected" read as a clean bill of health', () => {
    const text = toolByName('variance_findings')!.run(REPORT, {});

    expect(text).toContain('Nothing in this report was inspected');
    expect(text).toContain('not evidence that the renders were clean');
  });

  it('says so differently when the renders were inspected and were clean', () => {
    const clean: RunReport = {
      ...REPORT,
      observations: REPORT.observations.map((o) => ({ ...o, findings: [] })),
    };

    expect(toolByName('variance_findings')!.run(clean, {})).toContain(
      `No findings across ${clean.observations.length} inspected subject(s)`,
    );
    expect(toolByName('variance_summary')!.run(clean, {})).toContain(
      `findings: none in ${clean.observations.length} inspected subject(s)`,
    );
  });

  it('shows a subject its own findings even when nothing changed', () => {
    const text = toolByName('variance_describe')!.run(WITH_FINDINGS, {
      subject: 'ds/button--primary',
    });

    expect(text).toContain('[unchanged]');
    expect(text).toContain('independent of the verdict');
    expect(text).toContain('src/ds/IconButton.tsx:12');
  });
});

describe('tracing a component across the run', () => {
  it('separates being the cause from being displaced', () => {
    const text = call('variance_trace_component', { component: 'Stack' });

    expect(text).toContain('it is the cause in 0 of them');
    expect(text).toContain('[collateral]');
  });

  it('answers plainly for a component that appears nowhere', () => {
    expect(call('variance_trace_component', { component: 'Nonexistent' })).toContain(
      'does not appear in any region',
    );
  });
});

describe('explaining a verdict that is not a code problem', () => {
  it('tells an agent not to try fixing an incomparable baseline in code', () => {
    // The most valuable thing this tool does. An agent that reads
    // `incomparable` as a failure will start editing components to chase a
    // difference caused by a font stack.
    const text = call('variance_explain_verdict', { subject: 'page/todos--empty' });

    expect(text).toContain('not a code change and cannot be fixed in code');
    expect(text).toContain('ephemeral');
  });
});

describe('the protocol', () => {
  it('announces itself and its tools', () => {
    const initialize = handle({ jsonrpc: '2.0', id: 1, method: 'initialize' }, () => REPORT, REPORTS);
    expect((initialize!.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL_VERSION);

    const list = handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, () => REPORT, REPORTS);
    const tools = (list!.result as { tools: { name: string }[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
  });

  it('never answers a notification', () => {
    // A notification that gets a response is a protocol violation, and the one
    // every hand-written server commits.
    expect(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, () => REPORT, REPORTS)).toBeNull();
  });

  it('refuses an unknown method and an unknown tool differently', () => {
    expect(handle({ jsonrpc: '2.0', id: 1, method: 'nope' }, () => REPORT, REPORTS)!.error?.code).toBe(-32601);
    expect(
      handle(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } },
        () => REPORT,
        REPORTS,
      )!.error?.code,
    ).toBe(-32602);
  });

  it('every declared tool can actually be called', () => {
    for (const tool of TOOLS) expect(toolByName(tool.name)).toBe(tool);
  });
});

describe('framing', () => {
  it('reassembles a value split across chunk boundaries', () => {
    // A stdio chunk boundary falls where the OS puts it. Getting this wrong
    // produces a parse error under load and never in a test.
    const lines: string[] = [];
    const read = createLineReader((line) => lines.push(line));

    read('{"a":1}\n{"b"');
    read(':2}\n');

    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('ignores blank lines rather than parsing them', () => {
    const lines: string[] = [];
    createLineReader((line) => lines.push(line))('\n\n{"a":1}\n');
    expect(lines).toEqual(['{"a":1}']);
  });
});

/** One `tools/call` for a subject, by id. */
function ask(id: number, subject: string): unknown {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'variance_describe', arguments: { subject } },
  };
}

/**
 * Read one response line at a time.
 *
 * Attached before the first request rather than per-request, so a reply that
 * arrives while nobody is listening is still there to be read.
 */
function readLines(output: PassThrough): () => Promise<string> {
  const held: string[] = [];
  let waiting: ((line: string) => void) | undefined;

  let buffer = '';
  output.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (waiting !== undefined) {
        const resolve = waiting;
        waiting = undefined;
        resolve(line);
      } else {
        held.push(line);
      }
    }
  });

  return () => {
    const line = held.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise<string>((resolve) => {
      waiting = resolve;
    });
  };
}

describe('the server', () => {
  it('answers a request written to its input', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    serve({ input, output, served: REPORTS, subject: () => REPORT });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);

    const line = await new Promise<string>((resolve) => output.once('data', resolve));
    expect(JSON.parse(String(line)).result.tools).toHaveLength(TOOLS.length);
  });

  it('survives unparseable input instead of exiting', () => {
    const input = new PassThrough();
    const output = new PassThrough();

    serve({ input, output, served: REPORTS, subject: () => REPORT });
    expect(() => input.write('not json\n')).not.toThrow();
  });

  it('answers from the report as it is now, not as it was at boot', async () => {
    // The failure this prevents is the worst one the package can produce. An
    // agent fixes something, re-runs, asks again — and is told from the previous
    // report that its edit did not take.
    const directory = await mkdtemp(join(tmpdir(), 'va-mcp-'));
    try {
      const path = join(directory, 'run.json');
      await writeRunReport(path, REPORT);

      const input = new PassThrough();
      const output = new PassThrough();
      const lines = readLines(output);
      const stop = await serveReportFile(path, { input, output });

      try {
        input.write(`${JSON.stringify(ask(1, 'story:card--populated'))}\n`);
        expect(await lines()).toContain('story:card--populated');

        await writeRunReport(path, {
          ...REPORT,
          observations: REPORT.observations.map((observation) => ({
            ...observation,
            subject: 'story:card--rewritten',
          })),
        });

        input.write(`${JSON.stringify(ask(2, 'story:card--rewritten'))}\n`);
        const answer = await lines();
        expect(answer).toContain('story:card--rewritten');
        expect(answer).not.toContain('unknown subject');
      } finally {
        stop();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('the report file', () => {
  it('round-trips', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'va-mcp-'));
    try {
      const path = join(directory, 'run.json');
      await writeRunReport(path, REPORT);
      expect(await readRunReport(path)).toEqual(REPORT);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses a file that is not a run report', async () => {
    // These answers get acted on. A silently misparsed report produces confident
    // statements about fields that were never there.
    const directory = await mkdtemp(join(tmpdir(), 'va-mcp-'));
    try {
      const path = join(directory, 'other.json');
      await writeFile(path, '{"hello":"world"}', 'utf8');
      await expect(readRunReport(path)).rejects.toThrow(/not a variance-authority run report/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it.todo(
  'a client process completes initialize, tools/list and tools/call against `variance-authority-mcp` over real stdio — needs `packages/mcp/dist/bin.js` built and a report file to serve',
);
