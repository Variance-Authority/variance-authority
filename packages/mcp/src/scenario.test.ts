import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core';
import { REPORTS, handle } from './protocol.js';
import type {
  NotObserved,
  ObservationRecord,
  RunReport,
} from '@variance-authority/report';
import { readRunReport } from '@variance-authority/report/file';

/**
 * The scenario this product exists to refuse: a coverage hole reading as a clean
 * run.
 *
 * A suite plans 300 subjects, the collector throws on 50, and the other 250 are
 * unchanged. Every number an agent is shown is then true and the conclusion it
 * draws is false — "nothing changed" over a surface that was never looked at is
 * indistinguishable, in the output, from a suite that watched everything.
 *
 * These are scenario tests rather than unit tests on purpose. The individual
 * pieces were each correct: the CLI counted the failures, `exitFor` returned 1,
 * and every tool answered its own question honestly. The defect lived in the
 * seam — the MCP `RunReport` did not carry the coverage list at all, so the tools
 * answered honestly about a report that had been stripped of the only field that
 * could contradict them. Only a test that plays the whole scenario out sees it.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/sha256-abc'],
};

const OBSERVED: readonly ObservationRecord[] = Array.from({ length: 250 }, (_, index) => ({
  subject: `story:seen-${index}`,
  verdict: 'unchanged',
  because: 'no pixels differ',
  changedPixels: 0,
  regions: [],
}));

const UNSEEN: readonly NotObserved[] = Array.from({ length: 50 }, (_, index) => ({
  subject: `story:unseen-${index}`,
  kind: 'failed',
  because: 'the collector threw while mounting the story',
}));

/** 300 planned, 250 observed, 50 holes. The run the CLI already exits 1 over. */
const HOLED: RunReport = {
  runVersion: 1,
  at: '2026-08-01T10:00:00.000Z',
  identity: IDENTITY,
  retention: 'durable',
  intent: 'bump the design tokens',
  observations: OBSERVED,
  notObserved: UNSEEN,
};

/** The same run, having accounted for every subject it planned. */
const COMPLETE: RunReport = { ...HOLED, notObserved: [] };

/** A report written by something that never stated its coverage at all. */
const { notObserved: dropped, ...SILENT } = HOLED;
void dropped;

/** One of each kind, for the three-state line and for the two `describe` answers. */
const MIXED: RunReport = {
  ...HOLED,
  notObserved: [
    { subject: 'story:chart', kind: 'failed', because: 'the story never became ready' },
    { subject: 'story:docs', kind: 'excluded', because: 'tagged `!test`' },
  ],
};

function call(report: RunReport, name: string, args: Record<string, unknown> = {}): string {
  const response = handle(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    () => report,
    REPORTS,
  );
  const result = response!.result as { content: { text: string }[]; isError?: boolean };
  return result.content[0]!.text;
}

describe('a run that could not see 50 of the 300 subjects it planned', () => {
  it('never says "nothing to review" over a 50-subject hole', () => {
    // The whole defect in one assertion. Every observation is `unchanged`, so a
    // summary that only reads `observations` concludes the run is clean — over a
    // surface it never looked at. The CLI's exit code already returns 1 here; an
    // agent asking the same file through MCP was told the opposite.
    const text = call(HOLED, 'variance_summary');

    expect(text).not.toContain('nothing to review');
  });

  it('counts and names the subjects it could not see', () => {
    // Counting without naming would leave an agent unable to act; naming without
    // counting would let a long list be skimmed. The wording is the CLI's, because
    // a human and an agent reading the same run must not read two descriptions.
    const text = call(HOLED, 'variance_summary');

    expect(text).toContain('not observed: 50 subject(s)');
    expect(text).toContain('50 the run could not see, 0 excluded by configuration');
    expect(text).toContain('[failed] story:unseen-0: the collector threw while mounting the story');
  });

  it('states the hole in the first four lines, not below fifty lines of detail', () => {
    // Naming all 50 is right and makes the section as long as the hole. A reader
    // — or a client that truncates — must not therefore meet "250 unchanged" with
    // nothing to contradict it until line 56.
    const head = call(HOLED, 'variance_summary').split('\n').slice(0, 4).join('\n');

    expect(head).toContain('250 unchanged, 50 not observed');
  });

  it('still counts the 250 subjects it did observe without listing them', () => {
    // The coverage list must not cost the summary the property that made it
    // readable: a 300-subject run prints what needs attention, not the suite.
    const text = call(HOLED, 'variance_summary');

    expect(text).toContain('250 unchanged');
    expect(text).not.toContain('story:seen-3:');
  });
});

describe('a subject that appears only in the coverage list', () => {
  it('is described from the coverage list rather than refused as unknown', () => {
    // "Unknown subject" for something the run deliberately or accidentally did not
    // look at sends an agent hunting for a typo instead of reading the reason,
    // which is right here.
    const text = call(MIXED, 'variance_describe', { subject: 'story:chart' });

    expect(text).toContain('[not observed] story:chart');
    expect(text).toContain('the story never became ready');
    expect(text).toContain('It is not a pass.');
  });

  it('separates an exclusion somebody chose from a failure nobody did', () => {
    const text = call(MIXED, 'variance_describe', { subject: 'story:docs' });

    expect(text).toContain('excluded by configuration, not by a failure');
    expect(text).not.toContain('It is not a pass.');
  });

  it('is explained as nothing-is-known rather than as a verdict', () => {
    // `variance_explain_verdict` is the tool an agent calls before attempting a
    // fix. Throwing "unknown subject" here is the worst available answer: the
    // agent concludes the subject does not exist and moves on.
    const text = call(MIXED, 'variance_explain_verdict', { subject: 'story:chart' });

    expect(text).toContain('the story never became ready');
    expect(text).toContain('nothing is known');
    expect(text).not.toContain('unknown subject');
  });

  it('appears among the alternatives when the name really is unknown', () => {
    const text = call(MIXED, 'variance_describe', { subject: 'story:typo' });

    expect(text).toContain('unknown subject');
    expect(text).toContain('story:chart');
  });
});

describe('the three states of coverage', () => {
  it('says nothing to review only when the report accounted for every subject', () => {
    const text = call(COMPLETE, 'variance_summary');

    expect(text).toContain('coverage: every planned subject was observed.');
    expect(text).toContain('nothing to review');
  });

  it('refuses to call a report clean when it never said what it skipped', () => {
    // Absent is not empty, and this is the state a reader most wants collapsed.
    // A report that never counted its subjects cannot support the sentence
    // "nothing needs review" — silence about a subject is not a pass, and
    // printing one as the other is the tool inventing the reassurance.
    const text = call(SILENT, 'variance_summary');

    expect(text).toContain('coverage: unknown');
    expect(text).not.toContain('nothing to review');
    expect(text).not.toContain('every planned subject was observed');
    // And in the header too, for the same reason the hole is stated there.
    expect(text.split('\n').slice(0, 4).join('\n')).toContain('coverage unknown');
  });
});

describe('reading a coverage list off disk', () => {
  it('refuses an entry whose kind is none of the three', async () => {
    // Not defaulted, in any direction. Guessing `excluded` would turn a
    // coverage hole into a decision somebody made; guessing `failed` would turn
    // every deliberate exclusion permanently red; guessing `unreached` would
    // credit the run with reasoning it never did. A summary that claims a run is
    // clean is only as trustworthy as the field it claims it from.
    const directory = await mkdtemp(join(tmpdir(), 'va-mcp-scenario-'));
    try {
      const path = join(directory, 'run.json');
      await writeFile(
        path,
        JSON.stringify({ ...HOLED, notObserved: [{ subject: 'x', kind: 'skipped', because: 'y' }] }),
        'utf8',
      );

      await expect(readRunReport(path)).rejects.toThrow(
        /none of "excluded", "failed" or "unreached"/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves an absent coverage list as absent, never as empty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'va-mcp-scenario-'));
    try {
      const path = join(directory, 'run.json');
      await writeFile(path, JSON.stringify(SILENT), 'utf8');

      expect((await readRunReport(path)).notObserved).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
