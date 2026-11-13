import { afterEach, describe, expect, it } from 'vitest';
import type { JourneyReport } from './journey.js';
import { UNATTRIBUTED } from './stitch.js';
import { STORY_VARIABLE } from '../story/asked.js';
import { driver, evaluate, forget, head, inRoot } from './__fixtures__/journey-head.js';

/**
 * The head and the story format as they ship: built, because the tap and the
 * format `require` their neighbours by the names the build gives them.
 */
const { collectJourneys } = (await import('../../dist/test-selection/journey.js')) as typeof import('./journey.js');
const storyFormat = (await import('../../dist/story/format.cjs')).default as typeof import('../story/format.cjs');

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
