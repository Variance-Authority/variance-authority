import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { instrument } from '../instrument/index.js';
import probeLog from '../instrument/probe-log.cjs';
import probeSet from '../instrument/probe-set.cjs';
import { DRIVEN_GLOBAL, TELLER_GLOBAL } from '../test-selection/execution-global.js';
import { PAGE_STORY } from './page-story.js';

/** Built, as `format.test.ts` reads it: the format `require`s its neighbours by the names the build gives them. */
const { toldCollectorSource } = (await import('../../dist/story/page-told.js')) as typeof import('./page-told.js');
const { decodeStory } = (await import('../../dist/story/format.cjs')).default as typeof import('./format.cjs');
const storyTap = createRequire(import.meta.url)('../../dist/instrument/story-tap.cjs') as typeof import('../instrument/story-tap.cjs');

const CART = `
function add(item) { console.log('adding ' + item); return item }
function many(n) { for (let i = 0; i < n; i++) add(i) }
`;

/**
 * A page a build asked for stories: what the build put before the collector,
 * then the collector's part, which hands its engine to the maker the build
 * left, then `cart.js` evaluated against the root the maker returned.
 */
function page() {
  const realm: Record<string | symbol, unknown> = { document: {}, console: { log: () => {} }, TextEncoder, btoa };
  createContext(realm);
  runInContext(toldCollectorSource(''), realm);
  const engine = probeLog.createEngine(false, probeSet.probeSet);
  engine.use(engine.open(''));
  // A symbol a realm's script keys its global by is read in the realm: a context does not mirror it.
  const make = runInContext(`globalThis[Symbol.for(${JSON.stringify(PAGE_STORY)})]`, realm) as (given: typeof engine) => {
    root: object;
    take(): { visits: number; notes: [number, string][] };
  };
  const made = make(engine);
  realm.__VA__ = made.root;
  runInContext(instrument(CART, 'cart.js')!.code, realm, { filename: 'cart.js' });
  const teller = realm[TELLER_GLOBAL] as { telling: boolean; tell(journey: string, ended: boolean, room?: number): string | undefined };
  return {
    run: (code: string): unknown => runInContext(code, realm),
    say: (text: string): void => (runInContext("globalThis[Symbol.for('variance-authority.story.note')]", realm) as (said: string) => void)(text),
    tell: (journey: string, ended = true) => {
      const told = teller.tell(journey, ended);
      return told === undefined ? undefined : decodeStory(Buffer.from(told, 'base64'));
    },
    told: (journey: string, room: number) => teller.tell(journey, true, room)!,
    drain: () => made.take(),
    claim: () => {
      realm[DRIVEN_GLOBAL] = true;
    },
    telling: (now: boolean) => {
      teller.telling = now;
    },
  };
}

const texts = (story: ReturnType<typeof decodeStory>): string[] => story.notes.map(([, text]) => text);

describe('a page that tells what an execution ran', () => {
  it('tells what ran since it last told, under the execution, with what each function was handed and never what a module holds', () => {
    const cart = page();
    cart.run("add('socks')");

    const story = cart.tell('7f3a')!;

    expect(story).toMatchObject({ file: '7f3a', name: '', untaped: 0, unnoted: 0, beforeNotes: [] });
    expect(story.visits.length).toBeGreaterThan(0);
    expect(texts(story)).toEqual(["handed item='socks'", 'console.log adding socks']);
    expect(cart.tell('7f3a')).toBeUndefined();
  });

  it('charges what the page said to what it says, whatever its words, and what a function was handed to that alone', () => {
    const cart = page();
    cart.run("add('socks')");
    // The rest of what the page may say, in words a function's handing starts with.
    for (let at = 1; at < storyTap.PART_NOTES; at += 1) cart.say(`handed by hand ${at}`);
    cart.run("add('shoes')");

    const story = cart.tell('7f3a')!;

    expect(texts(story)).toContain("handed item='shoes'");
    expect(texts(story)).not.toContain('console.log adding shoes');
    expect(texts(story)).toHaveLength(storyTap.PART_NOTES + 2);
    expect(story.unnoted).toBe(1);
  });

  it('tells an execution not ended once its part has stopped growing, and what ran after that apart', () => {
    const cart = page();
    cart.run("add('socks')");
    expect(cart.tell('7f3a', false)).toBeUndefined();

    expect(texts(cart.tell('7f3a', false)!)).toEqual(["handed item='socks'", 'console.log adding socks']);
    cart.run("add('shoes')");
    expect(cart.tell('7f3a', false)).toBeUndefined();
    expect(texts(cart.tell('7f3a', false)!)).toEqual(["handed item='shoes'", 'console.log adding shoes']);
  });

  it('keeps notes alone for the end of an execution', () => {
    const cart = page();
    // What evaluating `cart.js` ran, told first.
    cart.tell('7f3a');
    cart.say('paint first contentful');
    expect(cart.tell('7f3a', false)).toBeUndefined();
    expect(cart.tell('7f3a', false)).toBeUndefined();

    expect(texts(cart.tell('7f3a')!)).toEqual(['paint first contentful']);
  });

  it('tells within the room it is given the first of what ran, and counts the rest', () => {
    const [cut, whole] = [page(), page()];
    for (const cart of [cut, whole]) cart.run(`many(${storyTap.PART_LIMIT})`);
    const room = 32 << 10;

    const told = cut.told('7f3a', room);
    const story = decodeStory(Buffer.from(told, 'base64'));
    const all = whole.tell('7f3a')!;

    expect(told.length).toBeLessThanOrEqual(room);
    expect(story.visits.length).toBeGreaterThan(0);
    expect(story.notes.length).toBeGreaterThan(0);
    expect(story.visits).toEqual(all.visits.slice(0, story.visits.length));
    expect(story.visits.length + story.untaped).toBe(all.visits.length + all.untaped);
    expect(story.notes.length + story.unnoted).toBe(all.notes.length + all.unnoted);
  });

  it('hands a driver that claims the page what it ran since it was last told, and keeps none of it to tell', () => {
    const cart = page();
    cart.tell('7f3a');
    cart.run("add('socks')");

    const drained = cart.drain();

    expect(drained.visits).toBeGreaterThan(0);
    expect(drained.notes.map(([, text]) => text)).toEqual(["handed item='socks'", 'console.log adding socks']);
    expect(cart.tell('7f3a')).toBeUndefined();
  });

  it('leaves what ran to the teller while the page tells it, so a drain for its regions takes none of it', () => {
    const cart = page();
    cart.tell('7f3a');
    cart.telling(true);
    cart.run("add('socks')");

    expect(cart.drain().visits).toBe(0);
    expect(texts(cart.tell('7f3a')!)).toEqual(["handed item='socks'", 'console.log adding socks']);
  });

  it('hands what ran to a driver that claims the page as it drains, before the page stops telling', () => {
    const cart = page();
    cart.tell('7f3a');
    cart.telling(true);
    cart.run("add('socks')");
    cart.claim();

    expect(cart.drain().notes.map(([, text]) => text)).toEqual(["handed item='socks'", 'console.log adding socks']);
  });

  it('keeps what a live head keeps of one execution, and counts the rest', () => {
    const cart = page();
    cart.run(`many(${storyTap.PART_LIMIT})`);

    const story = cart.tell('7f3a')!;

    expect(story.visits).toHaveLength(storyTap.PART_LIMIT);
    expect(story.untaped).toBeGreaterThan(0);
    expect(story.notes.length + story.unnoted).toBe(2 * storyTap.PART_LIMIT + 1);
  });
});
