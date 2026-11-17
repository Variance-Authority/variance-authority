import { EventEmitter } from 'node:events';
import type { BrowserContext, Request } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { heardRequests } from './requests.js';

/** A request as Playwright's events hand it over, of `kind`. */
function request(method: string, url: string, kind = 'fetch'): Request {
  return { method: () => method, url: () => url, resourceType: () => kind } as unknown as Request;
}

/** A context whose events the test raises itself. */
function context() {
  const events = new EventEmitter();
  return { events, context: events as unknown as BrowserContext };
}

describe('the requests a story tells', () => {
  it('tells each line what it sent, what came back with its status or as failed, and what is still out', () => {
    const { events, context: heard } = context();
    const requests = heardRequests();
    requests.hear(heard);
    const [order, price, stock] = [request('POST', 'http://shop.test/api/order'), request('GET', 'http://shop.test/api/price?token=secret'), request('GET', 'http://shop.test/api/stock')];

    for (const sent of [order, price, stock]) events.emit('request', sent);
    expect(requests.told()).toEqual(['sent POST /api/order, GET /api/price, GET /api/stock', 'still out POST /api/order, GET /api/price, GET /api/stock']);

    events.emit('response', { request: () => order, status: () => 201 });
    events.emit('requestfinished', order);
    events.emit('requestfailed', stock);
    expect(requests.told()).toEqual(['POST /api/order 201', 'GET /api/stock failed', 'still out GET /api/price']);
    // A line on which nothing moved still ends with the price out.
    expect(requests.told()).toEqual(['still out GET /api/price']);
  });

  it('leaves out what is no fetch of a path, and what no page waits on', () => {
    const { events, context: heard } = context();
    const requests = heardRequests();
    requests.hear(heard);

    events.emit('request', request('GET', 'data:text/plain,hello'));
    events.emit('request', request('GET', 'http://shop.test/logo.png', 'image'));
    expect(requests.told()).toEqual([]);
  });

  it('hears nothing more from a context once it stops, and holds none of its requests still out', () => {
    const { events, context: heard } = context();
    const requests = heardRequests();
    const stop = requests.hear(heard);
    events.emit('request', request('GET', 'http://shop.test/api/stock'));
    stop();

    events.emit('request', request('GET', 'http://shop.test/api/price'));
    expect(requests.told()).toEqual(['sent GET /api/stock']);
    expect(requests.told()).toEqual([]);
  });
});
