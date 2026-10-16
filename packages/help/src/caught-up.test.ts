import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishing, UNCOMPARED } from './__fixtures__/published-then-written.js';
import { caughtUp, snapshotLine } from './caught-up.js';
import { serveWorkspace } from './server.js';

/**
 * A question about a name written after the last published generation, asked
 * of this package's server. A generation is reused for an hour, so the name was
 * refused as not published — an answer that reads as a real absence — while
 * `variance ask` read the checkout again first.
 */

const fixture = publishing();
beforeEach(fixture.before);
afterEach(fixture.after);

async function served(root: string, justAnswer: boolean): Promise<{ text: string; isError?: boolean }> {
  const input = new PassThrough();
  const output = new PassThrough();
  const stop = serveWorkspace(root, { input, output, justAnswer });
  try {
    const line = new Promise<string>((resolve) => output.once('data', (chunk: Buffer) => resolve(chunk.toString())));
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'docs_symbol', arguments: { name: 'keptOf' } } })}\n`);
    const result = (JSON.parse(await line) as { result: { content: { text: string }[]; isError?: boolean } }).result;
    return { text: result.content[0]!.text, ...(result.isError === undefined ? {} : { isError: result.isError }) };
  } finally {
    stop();
  }
}

/** The date line of a refusal whose checkout could not be compared with its generation, and why. */
const UNREAD = /Snapshot \d{4}-\d\d-\d\dT[\d:.]+Z, not compared with the checkout \((.+)\): run `variance index` if files changed since\./u;

describe('caughtUp', () => {
  it('asks again, of a current generation, a refusal from one made before the question', async () => {
    const started = Date.now();
    expect(await caughtUp(new Date(started - 1000).toISOString(), started, undefined, async (current) => current)).toEqual({ subject: true });
  });

  it('says the checkout was not compared, and why, when reading it again fails', async () => {
    const started = Date.now();
    const caught = await caughtUp(new Date(started - 1000).toISOString(), started, undefined, async () => {
      throw new Error('a manifest is half-written');
    });
    expect(caught?.subject).toBeUndefined();
    expect(caught?.footer).toMatch(UNREAD);
    expect(caught?.footer).toContain('a manifest is half-written');
  });

  it('says the installed packages were not compared, and why, when the dependency lexicon cannot be refreshed', async () => {
    const started = Date.now();
    // A directory git does not hold has no installed packages to list. The
    // generation was made during the question, so its source was compared.
    const caught = await caughtUp(new Date(started + 1).toISOString(), started, fixture.cache(), async () => 'asked again');
    expect(caught?.subject).toBeUndefined();
    expect(caught?.footer).toMatch(/^Installed packages not compared with the checkout: the dependency lexicon could not be refreshed \(.+\)\.$/u);
    expect(caught?.footer).not.toMatch(/^Snapshot/u);
  });

  it('lets a refusal stand from a generation made during the question, or from none', async () => {
    const started = Date.now();
    const again = async (): Promise<string> => 'asked again';
    expect(await caughtUp(new Date(started + 1).toISOString(), started, undefined, again)).toBeUndefined();
    expect(await caughtUp(undefined, started, undefined, again)).toBeUndefined();
  });
});

describe('snapshotLine', () => {
  it('names the generation time, and says when the checkout was not compared with it, and why when it was asked to be', () => {
    expect(snapshotLine('2026-01-02T03:04:05.000Z', false)).toBe('Snapshot 2026-01-02T03:04:05.000Z.');
    expect(snapshotLine('2026-01-02T03:04:05.000Z', true)).toMatch(UNCOMPARED);
    expect(snapshotLine('2026-01-02T03:04:05.000Z', 'it could not be read')).toMatch(UNREAD);
  });
});

describe('the help server about a name written after the published generation', () => {
  it('reads the checkout again before refusing `docs_symbol`', async () => {
    const answer = await served(await fixture.published(), false);
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toContain('packages/kit/src/kept.ts');
  });

  it('refuses under `justAnswer` with when the generation was published and that the checkout was not compared with it', async () => {
    const answer = await served(await fixture.published(), true);
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain('keptOf');
    expect(answer.text).toMatch(UNCOMPARED);
  });
});
