import { randomUUID } from 'node:crypto';
import * as api from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTelemetry, sentry, type JourneyTrace } from './journey.js';

const journey = (): string => randomUUID().replaceAll('-', '');

beforeAll(() => {
  Sentry.init({
    dsn: 'https://public@127.0.0.1:1/1',
    transport: () => ({ send: async () => ({}), flush: async () => true }),
  });
});

afterAll(async () => {
  await Sentry.close();
});

// The application's own SDK namespaces are what a head is handed; these calls
// are also the check that the adapters accept them as they are typed.
const tracers: [string, () => JourneyTrace][] = [
  ['sentry', () => sentry(Sentry)],
  ['opentelemetry', () => {
    api.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    return openTelemetry(api);
  }],
];

describe.each(tracers)('a journey carried by %s', (_, make) => {
  it('is the trace id inside the case, across an await, and not after it', async () => {
    const trace = make();
    const id = journey();
    const seen = await trace.carry(id, 'a case', async () => {
      const before = trace.current();
      await new Promise((resume) => setTimeout(resume, 1));
      return [before, trace.current()];
    });
    expect(seen).toEqual([id, id]);
    expect(trace.current()).not.toBe(id);
  });

  it('keeps two cases apart while they interleave', async () => {
    const trace = make();
    const [first, second] = [journey(), journey()];
    const read = (id: string) => trace.carry(id, id, async () => {
      await new Promise((resume) => setTimeout(resume, 2));
      return trace.current();
    });
    expect(await Promise.all([read(first), read(second)])).toEqual([first, second]);
  });
});
