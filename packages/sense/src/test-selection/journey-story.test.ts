import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { mintJourney, type JourneyReport } from './journey.js';
import { UNATTRIBUTED } from './stitch.js';
import { STORY_VARIABLE } from '../story/asked.js';
import { driver, evaluate, forget, head, inRoot } from './__fixtures__/journey-head.js';

/**
 * The head and the story format as they ship: built, because the tap and the
 * format `require` their neighbours by the names the build gives them.
 */
const { collectJourneys } = (await import('../../dist/test-selection/journey.js')) as typeof import('./journey.js');
const storyFormat = (await import('../../dist/story/format.cjs')).default as typeof import('../story/format.cjs');
const storyTap = (await import('../../dist/instrument/story-tap.cjs')).default as typeof import('../instrument/story-tap.cjs');

const told = process.env[STORY_VARIABLE];

afterEach(async () => {
  if (told === undefined) delete process.env[STORY_VARIABLE];
  else process.env[STORY_VARIABLE] = told;
  await forget();
});

/** What each execution was handed, by journey, read back from the stories its accounts carried. */
function handed(reports: readonly JourneyReport[]): Map<string, string[]> {
  const byJourney = new Map<string, string[]>();
  for (const report of reports) {
    if (report.journey === UNATTRIBUTED || report.story === undefined) continue;
    const story = storyFormat.decodeStory(Buffer.from(report.story, 'base64'));
    const said = [...story.beforeNotes, ...story.notes].map(([, text]) => text);
    byJourney.set(report.journey, [...(byJourney.get(report.journey) ?? []), ...said]);
  }
  return byJourney;
}

describe('a head started with VARIANCE_AUTHORITY_STORY=1', () => {
  it('tells the watcher what each execution was handed, and keeps two interleaved executions apart', async () => {
    await inRoot(async (root) => {
      process.env[STORY_VARIABLE] = '1';
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);

      await Promise.all([
        collector.enter('theme=dark', () => parts.currency('de')),
        collector.enter('theme=dark', () => parts.currency('en')),
      ]);
      await collector.close();

      const stories = [...handed(watcher.reports).values()].sort((left, right) => left.join().localeCompare(right.join()));
      expect(stories).toEqual([
        ["handed locale='de'", 'handed value=1200'],
        ["handed locale='en'", 'handed value=1200'],
      ]);
    });
  });

  it('says nothing of what a module holds: a live run shows arguments only', async () => {
    await inRoot(async (root) => {
      process.env[STORY_VARIABLE] = '1';
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const source = 'const rate = 2;\nglobalThis.__head_test_currency = async (locale) => `${rate} ${locale}`;';
      const parts = await head(root, 'build', { source, lazy: true });

      // Loaded by the request that first needs it, so its top level runs inside that execution.
      await collector.enter('theme=dark', () => evaluate(parts.code)('de'));
      await collector.close();

      expect([...handed(watcher.reports).values()]).toEqual([["handed locale='de'"]]);
    });
  });

  it('tells a promise a request left running only what it ran since, while another request keeps the tape', async () => {
    await inRoot(async (root) => {
      process.env[STORY_VARIABLE] = '1';
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);
      let behind: Promise<string> | undefined;
      let release!: () => void;
      let go!: () => void;
      const held = new Promise<void>((resume) => (release = resume));
      const settled = new Promise<void>((resume) => (go = resume));

      // The second request is open the whole time, so nothing starts the tape again.
      const open = collector.enter('theme=dark', () => held);
      await collector.enter('theme=dark', async () => {
        await parts.currency('en');
        behind = settled.then(() => parts.currency('de'));
      });
      // Its request has settled before the promise it left runs on.
      go();
      await behind;
      release();
      await open;
      await collector.close();

      // Each once: the request that settled first, then the one held open, which was handed nothing.
      expect([...handed(watcher.reports).values()]).toEqual([
        ["handed locale='en'", 'handed value=1200', "handed locale='de'", 'handed value=1200'],
        [],
      ]);
    });
  });

  it('keeps telling what each execution was handed while one stays open, and holds only what is open', async () => {
    await inRoot(async (root) => {
      process.env[STORY_VARIABLE] = '1';
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const HANDS = 64;
      const source = [
        'function hand(value) { return value; }',
        `globalThis.__head_test_currency = async (locale) => { for (let at = 0; at < ${HANDS}; at += 1) hand(at); return locale; };`,
      ].join('\n');
      const parts = await head(root, 'build', { source });
      let release!: () => void;
      const held = new Promise<void>((resume) => (release = resume));

      // Open the whole time, so the head is never idle; together the executions
      // after it are handed more than the tape keeps notes of.
      const open = collector.enter('theme=dark', () => held);
      const executions = storyTap.NOTE_LIMIT / HANDS + 8;
      for (let execution = 0; execution < executions; execution += 1) {
        await collector.enter('theme=dark', () => parts.currency(`l${execution}`));
      }
      const holding = storyTap.tapOf((globalThis as { __VA__?: unknown }).__VA__)!.holding();
      release();
      await open;
      await collector.close();

      const told = (execution: number): string[] => [`handed locale='l${execution}'`, ...Array.from({ length: HANDS }, (_, at) => `handed value=${at}`)];
      // In the order the executions ran, which is not always the order their accounts arrived in.
      const ran = (said: readonly string[]): number => Number(/l(\d+)/.exec(said[0]!)![1]);
      const stories = [...handed(watcher.reports).values()].filter((said) => said.length > 0).sort((left, right) => ran(left) - ran(right));
      expect(stories).toEqual(Array.from({ length: executions }, (_, execution) => told(execution)));
      // Every execution told is let go: the open one ran nothing, and nothing else is kept.
      expect(holding).toEqual({ visits: 0, notes: 0 });
    });
  });

  it("never lets one execution's chatter, or the process's own work, silence another's", async () => {
    await inRoot(async (root) => {
      process.env[STORY_VARIABLE] = '1';
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const chatter = storyTap.NOTE_LIMIT + 8;
      const source = [
        'function hand(value) { return value; }',
        `globalThis.__head_test_chatter = () => { for (let at = 0; at < ${chatter}; at += 1) hand(at); };`,
        'globalThis.__head_test_currency = async (locale) => { hand(locale); return locale; };',
      ].join('\n');
      const parts = await head(root, 'build', { source });
      const chatterOf = (globalThis as { __head_test_chatter?: () => void }).__head_test_chatter!;
      let release!: () => void;
      const held = new Promise<void>((resume) => (release = resume));

      // Outside any request, as a server's boot or its timers run.
      chatterOf();
      // A request that stays open and is handed more than one telling keeps.
      const open = collector.enter('theme=dark', async () => {
        chatterOf();
        await held;
      });
      await collector.enter('theme=dark', () => parts.currency('first'));
      release();
      await open;
      await collector.close();

      expect([...handed(watcher.reports).values()]).toContainEqual(["handed locale='first'", "handed value='first'"]);
    });
  });

  // A character past ASCII takes up to three bytes once encoded, so the bound is on bytes, not characters.
  it.each(['x', '中'])('tells no more of one execution than a watcher keeps of it, handed %s', async (character) => {
    await inRoot(async (root) => {
      process.env[STORY_VARIABLE] = '1';
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const long = character.repeat(storyTap.NOTE_LENGTH);
      const source = [
        'function hand(a, b, c, d, e, f) { return a; }',
        `globalThis.__head_test_currency = async (locale) => { const long = '${long}'; for (let at = 0; at < 1 << 18; at += 1) hand(long + at, long, long, long, long, long); return locale; };`,
      ].join('\n');
      const parts = await head(root, 'build', { source });

      await collector.enter('theme=dark', () => parts.currency('de'));
      await collector.close();

      // The watcher's own bound, vantage's STORY_BYTES: a telling past it is counted there, never kept.
      const sizes = watcher.reports.filter((report) => report.journey !== UNATTRIBUTED && report.story !== undefined).map((report) => report.story!.length);
      expect(sizes).toHaveLength(1);
      expect(sizes[0]).toBeLessThanOrEqual(1 << 20);
    });
  });

  it('tells an open request once, when it settles, though a driven request settles while it runs', async () => {
    await inRoot(async (root) => {
      process.env[STORY_VARIABLE] = '1';
      const watcher = await driver();
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);
      let release!: () => void;
      const held = new Promise<void>((resume) => (release = resume));

      const open = collector.enter('theme=dark', async () => {
        await parts.currency('de');
        await held;
        await parts.currency('en');
      });
      await collector.enter(driven.carrying(mintJourney()), () => 0);
      release();
      await open;
      await collector.close();

      const told = watcher.reports.filter((report) => report.journey !== UNATTRIBUTED && report.story !== undefined);
      expect(told).toHaveLength(1);
      expect(handed(told)).toEqual(new Map([[told[0]!.journey, ["handed locale='de'", 'handed value=1200', "handed locale='en'", 'handed value=1200']]]));
    });
  });

  it('carries no story when the variable is unset', async () => {
    await inRoot(async (root) => {
      delete process.env[STORY_VARIABLE];
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);

      await collector.enter('theme=dark', () => parts.currency('de'));
      await collector.close();

      expect(watcher.reports.length).toBeGreaterThan(0);
      expect(watcher.reports.filter((report) => 'story' in report)).toEqual([]);
    });
  });
});

it('tells a story from a head a bundler packed, with no file of the package beside it', async () => {
  // An ES module bundle, given `require` for Node's own modules as such a bundle is.
  const bundle = join(tmpdir(), 'head.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../../dist/test-selection/journey-story.js', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const { tapeJourneys } = (await import(bundle)) as typeof import('./journey-story.js');
  const probeLog = (await import('../../dist/instrument/probe-log.cjs')).default as typeof import('../instrument/probe-log.cjs');

  const tape = tapeJourneys(probeLog.createEngine(true));

  expect(storyFormat.decodeStory(Buffer.from(tape.storyOf('j-1'), 'base64')).notes).toEqual([]);
});
