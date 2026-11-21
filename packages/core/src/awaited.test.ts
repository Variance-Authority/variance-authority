import { describe, expect, it } from 'vitest';
import { awaitedRequest } from './index.js';

const kind = (type: string) => ({ resourceType: () => type });

describe('awaitedRequest', () => {
  it('waits for a request that can carry an answer', () => {
    for (const type of ['document', 'fetch', 'xhr', 'script', 'stylesheet', 'other']) expect(awaitedRequest(kind(type))).toBe(true);
  });

  it('does not wait for a channel, a stream or an asset', () => {
    for (const type of ['eventsource', 'font', 'image', 'media', 'websocket']) expect(awaitedRequest(kind(type))).toBe(false);
  });
});
