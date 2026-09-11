import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import { formatReport } from './report.js';
import { readCliRunReport, writeCliRunReport, type CliRunReport } from './run.js';

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
  intent: 'restyle the toggle',
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
      images: { after: 'images/story%3Atoggle.after.png' },
    },
    {
      subject: 'story:card',
      verdict: 'unchanged',
      because: 'no pixels differ',
      changedPixels: 0,
      regions: [],
    },
  ],
  notObserved: [
    { subject: 'story:chart', kind: 'failed', because: 'the story never became ready' },
    { subject: 'story:docs', kind: 'excluded', because: 'tagged `!test`' },
  ],
  warnings: ['the index declared 1 entry this adapter does not understand'],
};

describe('formatReport, text', () => {
  it('leads with the summary the MCP tools produce, so a human and an agent agree', () => {
    // Two formatters over one artifact drift, and the day they do a person and an
    // agent read the same run and disagree about what it found.
    const text = formatReport({ report: REPORT, format: 'text' });

    expect(text).toContain('[changed] story:toggle — Toggle');
    expect(text).toContain('intent: restyle the toggle');
    // Unchanged subjects are counted, never listed.
    expect(text).toContain('1 unchanged');
    expect(text).not.toContain('story:card:');
  });

  it('lists every subject that was not observed, with its reason', () => {
    // Silence about a subject is indistinguishable from a pass. This is the whole
    // reason the CLI writes a second list beside the observations.
    const text = formatReport({ report: REPORT, format: 'text' });

    expect(text).toContain('not observed: 2 subject(s)');
    expect(text).toContain('[failed] story:chart: the story never became ready');
    expect(text).toContain('[excluded] story:docs: tagged `!test`');
  });

  it('says coverage is unknown when the report never stated what it skipped', () => {
    // Absent is not empty. Printing "everything was observed" over a report that
    // never counted its subjects would be the tool inventing the reassurance.
    const { notObserved, ...silent } = REPORT;
    void notObserved;

    const text = formatReport({ report: silent, format: 'text' });
    expect(text).toContain('coverage: unknown');
    expect(text).not.toContain('every planned subject was observed');
  });

  it('carries index warnings into the output rather than dropping them', () => {
    expect(formatReport({ report: REPORT, format: 'text' })).toContain(
      'does not understand',
    );
  });

  it.each([
    ['coverage: every planned subject was observed.', { ...REPORT, notObserved: [] }],
    ['not observed:', REPORT],
    ['coverage: unknown', (({ notObserved: _notObserved, ...rest }) => rest)(REPORT)],
  ] as const)('says %s exactly once', (phrase, report) => {
    // Every other assertion in this file uses `toContain`, which is satisfied by
    // the first copy of a line printed twice — so a duplicated coverage section
    // survived every test here and was found by the first real `variance run`.
    // Counting rather than containing is what would have caught it.
    const occurrences = formatReport({ report, format: 'text' }).split(phrase).length - 1;
    expect(occurrences).toBe(1);
  });

  it('prints the composition section, and stays silent when there is none', () => {
    // The section is the MCP tool's answer, through `tool()` like every other
    // shared one. What is decided here is only whether to ask: an absent
    // composition has a real answer — a raster-only run has no boundaries to
    // join — and it is the right answer to a question, not something to print
    // unprompted at the bottom of every image-tier run.
    expect(formatReport({ report: REPORT, format: 'text' })).not.toContain('composed');

    const composed: CliRunReport = {
      ...REPORT,
      composition: {
        subjects: ['story:toggle', 'story:card'],
        components: [
          {
            component: 'Toggle',
            subjects: ['story:toggle', 'story:card'],
            instances: 2,
            examples: ['story:toggle'],
            within: ['Card'],
            createdBy: ['Card'],
            renders: [],
            tokens: [],
            variants: 1,
            renderings: 1,
          },
        ],
        echoes: [],
        divergences: [],
        movements: [
          {
            subject: 'story:toggle',
            component: 'Toggle',
            bands: ['style'],
            cause: 'unexplained',
            because: 'no file, token or ancestor explains it',
            alsoIn: [],
            held: ['story:card'],
            standing: 'suspect',
          },
        ],
      },
    };

    const text = formatReport({ report: composed, format: 'text' });
    expect(text).toContain('1 component(s) across 2 subject(s)');
    expect(text).toContain('[suspect]');
    expect(text).toContain('held in 1 other place(s): story:card');
  });

  it('answers about a not-observed subject from the coverage list', () => {
    // "Unknown subject" here would send the reader hunting for a typo instead of
    // reading the reason, which is right there.
    const text = formatReport({ report: REPORT, format: 'text', subject: 'story:chart' });

    expect(text).toContain('[not observed] story:chart');
    expect(text).toContain('It is not a pass.');
  });

  it('refuses a subject the run never mentioned, listing the ones it has', () => {
    expect(() =>
      formatReport({ report: REPORT, format: 'text', subject: 'story:nope' }),
    ).toThrow(/no subject `story:nope`.*story:toggle/s);
  });
});

describe('formatReport, json', () => {
  it('round-trips through the run report contract unchanged', async () => {
    // The artifact is the contract: a run happens on a pinned machine and the
    // questions are asked elsewhere, so the JSON this prints has to be readable
    // back as the same report.
    const directory = await mkdtemp(join(tmpdir(), 'variance-cli-'));
    const path = join(directory, 'report.json');

    await writeCliRunReport(path, REPORT);
    const readBack = await readCliRunReport(path);
    expect(readBack).toEqual(REPORT);

    const printed = join(directory, 'printed.json');
    await writeFile(printed, formatReport({ report: readBack, format: 'json' }), 'utf8');
    expect(await readCliRunReport(printed)).toEqual(REPORT);
  });

  it('counts what a --subject filter removed instead of removing it silently', () => {
    // A filtered document is still a valid run report, which is what makes it
    // pipeable — and therefore indistinguishable from a run over one subject
    // unless the omission is stated.
    const json = JSON.parse(
      formatReport({ report: REPORT, format: 'json', subject: 'story:toggle' }),
    ) as { observations: unknown[]; selection: Record<string, unknown> };

    expect(json.observations).toHaveLength(1);
    expect(json.selection).toEqual({
      subject: 'story:toggle',
      omittedObservations: 1,
      omittedNotObserved: 2,
    });
  });

  it('leaves an unfiltered report free of a selection field', () => {
    const json = JSON.parse(formatReport({ report: REPORT, format: 'json' })) as Record<
      string,
      unknown
    >;
    expect(json['selection']).toBeUndefined();
  });
});

describe('readCliRunReport', () => {
  it('refuses a notObserved entry whose kind is none of the three', async () => {
    // Guessing `excluded` would turn a coverage hole into a decision somebody
    // made; guessing `failed` would turn every deliberate exclusion permanently
    // red; guessing `unreached` would credit the run with reasoning it never
    // did. No guess is available.
    const directory = await mkdtemp(join(tmpdir(), 'variance-cli-'));
    const path = join(directory, 'report.json');

    await writeFile(
      path,
      JSON.stringify({
        ...REPORT,
        notObserved: [{ subject: 'x', kind: 'skipped', because: 'why' }],
      }),
      'utf8',
    );

    await expect(readCliRunReport(path)).rejects.toThrow(
      /none of "excluded", "failed" or "unreached"/,
    );
  });

  it('preserves an absent notObserved list as absent, never as empty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-cli-'));
    const path = join(directory, 'report.json');
    const { notObserved, warnings, ...silent } = REPORT;
    void notObserved;
    void warnings;

    await writeFile(path, JSON.stringify(silent), 'utf8');
    expect((await readCliRunReport(path)).notObserved).toBeUndefined();
  });
});
