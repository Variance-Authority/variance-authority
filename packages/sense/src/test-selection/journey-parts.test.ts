import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectJourneys, mintJourney, type JourneyTrace } from './journey.js';
import { receiveParts } from './parts-receiver.js';
import { forget, head, inRoot } from './__fixtures__/journey-head.js';

afterEach(forget);

/** A trace that names whichever journey the test runs under, as an SDK's scope would. */
function tracing(): { trace: JourneyTrace; under: <Result>(journey: string, body: () => Result) => Result } {
  const running = new AsyncLocalStorage<string>();
  return {
    trace: { name: 'a test trace', carry: (journey, _name, body) => running.run(journey, body), current: () => running.getStore() },
    under: (journey, body) => running.run(journey, body),
  };
}

/** Every part the receiver has written so far, as text: a journey's id is its frame's owner. */
async function received(parts: string): Promise<string> {
  const files = await readdir(parts);
  const texts = await Promise.all(files.map((file) => readFile(resolve(parts, file), 'latin1')));
  return texts.join('');
}

// A Worker ends a request's work with its response, and a send it did not
// await is cancelled with it. So over HTTP nothing leaves on a timer, and
// nothing a scope sends is left behind when the scope hands its value back.
describe('a head writing parts over HTTP', () => {
  it('sends a journey the trace named outside any scope with the next scope\'s frame', async () => {
    await inRoot(async (root) => {
      const parts = resolve(root, 'parts');
      await mkdir(parts);
      const receiver = await receiveParts(parts);
      const { trace, under } = tracing();
      const journeys = collectJourneys({ head: 'api', enabled: true, parts: receiver.url, trace });
      try {
        const service = await head(root, 'api');
        const [straggler, held] = [mintJourney(), mintJourney()];
        await under(straggler, () => service.currency('de'));
        await new Promise((settle) => setTimeout(settle, 20));
        expect(await received(parts)).toBe('');

        await under(held, () => journeys.enter(undefined, () => service.currency('en')));
        const text = await received(parts);
        expect(text).toContain(straggler);
        expect(text).toContain(held);
      } finally {
        await journeys.close();
        await receiver.close();
      }
    });
  });

  it('hands a plain value back once its frame has landed', async () => {
    await inRoot(async (root) => {
      const parts = resolve(root, 'parts');
      await mkdir(parts);
      const receiver = await receiveParts(parts);
      const { trace, under } = tracing();
      const journeys = collectJourneys({ head: 'api', enabled: true, parts: receiver.url, trace });
      try {
        const service = await head(root, 'api');
        const journey = mintJourney();
        const answer = under(journey, () =>
          journeys.enter(undefined, () => {
            void service.currency('de');
            return 'answered';
          }),
        );
        expect(answer).toBeInstanceOf(Promise);
        expect(await answer).toBe('answered');
        expect(await received(parts)).toContain(journey);
      } finally {
        await journeys.close();
        await receiver.close();
      }
    });
  });
});
