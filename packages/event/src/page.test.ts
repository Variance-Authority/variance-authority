// The claim under test is that the page half is source with no dependencies —
// it runs in a bare realm — and that it drops nothing announced before the
// driver's channel exists, which is the window a page's first decision falls in.

import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { WIRE_REPORT, wireCarrierSource } from '@variance-authority/wire/listen';
import { EVENT_SINK, type AnnouncedEvent } from './index.js';
import { eventCollectorSource } from './page.js';

/** One report, as the page's carrier hands it over. */
interface Reported {
  readonly journey?: string;
  readonly participant: string;
  readonly body: AnnouncedEvent;
}

/** A realm with nothing in it but what the two sources put there. */
function realm(): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  const context = createContext(scope);
  runInContext('globalThis.globalThis = globalThis;', context);
  runInContext(wireCarrierSource(), context);
  runInContext(eventCollectorSource(), context);
  return scope;
}

function announce(scope: Record<string, unknown>, action: string): void {
  (scope[EVENT_SINK] as (...values: string[]) => void)('once', 'checkout', 'upsell', action);
}

/** The driver's end, arriving after the page has already started deciding. */
function take(scope: Record<string, unknown>, into: Reported[]): void {
  scope[WIRE_REPORT] = (said: Reported) => into.push(said);
}

describe('eventCollectorSource', () => {
  it('installs a sink on the name the announcing half reads', () => {
    expect(typeof realm()[EVENT_SINK]).toBe('function');
  });

  it('reports an announcement to the driver channel', () => {
    const scope = realm();
    const reported: Reported[] = [];
    take(scope, reported);
    announce(scope, 'decided');
    expect(reported).toEqual([
      {
        journey: undefined,
        participant: 'events',
        body: { phase: 'once', location: 'checkout', subject: 'upsell', action: 'decided' },
      },
    ]);
  });

  it('holds what was announced before the channel existed, in order', () => {
    const scope = realm();
    announce(scope, 'first');
    announce(scope, 'second');
    const reported: Reported[] = [];
    take(scope, reported);
    announce(scope, 'third');
    expect(reported.map((said) => said.body.action)).toEqual(['first', 'second', 'third']);
  });

  it('hands each held announcement over once', () => {
    const scope = realm();
    announce(scope, 'first');
    const reported: Reported[] = [];
    take(scope, reported);
    announce(scope, 'second');
    announce(scope, 'third');
    expect(reported.map((said) => said.body.action)).toEqual(['first', 'second', 'third']);
  });

  it('names the execution the document is carrying', () => {
    const scope = realm();
    scope['document'] = { cookie: 'theme=dark; variance-authority-journey=journey-one' };
    const reported: Reported[] = [];
    take(scope, reported);
    announce(scope, 'decided');
    expect(reported[0]?.journey).toBe('journey-one');
  });
});
