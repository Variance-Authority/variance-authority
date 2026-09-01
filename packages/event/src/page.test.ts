// The claim under test is that the page half is source with no dependencies —
// it runs in a bare realm — and that it drops nothing announced before the
// driver's channel exists, which is the window a page's first decision falls in.

import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { EVENT_SINK, type AnnouncedEvent } from './index.js';
import { EVENT_REPORT, eventCollectorSource } from './page.js';

/** A realm with nothing in it but what the source puts there. */
function realm(): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  const context = createContext(scope);
  runInContext('globalThis.globalThis = globalThis;', context);
  runInContext(eventCollectorSource(), context);
  return scope;
}

function announce(scope: Record<string, unknown>, action: string): void {
  (scope[EVENT_SINK] as (...values: string[]) => void)('once', 'checkout', 'upsell', action);
}

describe('eventCollectorSource', () => {
  it('installs a sink on the name the announcing half reads', () => {
    expect(typeof realm()[EVENT_SINK]).toBe('function');
  });

  it('reports an announcement to the driver channel', () => {
    const scope = realm();
    const reported: AnnouncedEvent[] = [];
    scope[EVENT_REPORT] = (event: AnnouncedEvent) => reported.push(event);
    announce(scope, 'decided');
    expect(reported).toEqual([
      { phase: 'once', location: 'checkout', subject: 'upsell', action: 'decided' },
    ]);
  });

  it('holds what was announced before the channel existed, in order', () => {
    const scope = realm();
    announce(scope, 'first');
    announce(scope, 'second');
    const reported: AnnouncedEvent[] = [];
    scope[EVENT_REPORT] = (event: AnnouncedEvent) => reported.push(event);
    announce(scope, 'third');
    expect(reported.map((event) => event.action)).toEqual(['first', 'second', 'third']);
  });

  it('hands each held announcement over once', () => {
    const scope = realm();
    announce(scope, 'first');
    const reported: AnnouncedEvent[] = [];
    scope[EVENT_REPORT] = (event: AnnouncedEvent) => reported.push(event);
    announce(scope, 'second');
    announce(scope, 'third');
    expect(reported.map((event) => event.action)).toEqual(['first', 'second', 'third']);
  });
});
