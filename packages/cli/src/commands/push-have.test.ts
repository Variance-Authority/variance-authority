import { describe, expect, it } from 'vitest';
import { push } from './push.js';
import { formatPush } from './push-progress.js';
import { SIDECAR, bytesDigest, digestOf, disk, header, options, report, surface } from './push-fixture.js';


/**
 * What a second push of an unchanged suite costs.
 *
 * The objects a deployment keeps are addressed by their content, so the run's
 * `before` — which *is* the baseline that deployment handed it — and the `after`
 * of every subject that did not move are bytes it already holds. Asking first
 * turns the whole of that into a digest apiece. The interesting cases are not
 * the happy one: they are the deployment that has never heard of the route, and
 * the size a `before` still has to carry when its bytes stay home.
 */
describe('asking what is already there', () => {
  const NAMED = {
    after: 'images/card.after.png',
    before: 'images/card.before.png',
    diff: 'images/card.diff.png',
  };

  const BASELINE = header(800, 600);

  // A real PNG header rather than a word, and read as bytes rather than through
  // `disk`: the baseline's size is read off its own header here, and a header
  // round-tripped through UTF-8 is no longer one.
  const read = async (path: string): Promise<Buffer> => {
    if (path === '/out/images/card.before.png') return BASELINE;
    if (path === '/out/images/card.after.json') return Buffer.from(SIDECAR, 'utf8');
    if (path === '/out/images/card.diff.png') return Buffer.from('DIFF', 'utf8');
    return Buffer.from('AFTER', 'utf8');
  };

  async function pushWith(answer: Parameters<typeof surface>[0]) {
    const service = surface(answer);
    const result = await push(
      options({ report: report(NAMED), deps: { fetch: service.fetch, read } }),
    );
    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)['story:card']!;
    return { service, result, images };
  }

  it('asks the ingest route about every image before posting any of them', async () => {
    const { service } = await pushWith({});

    expect(service.asked()?.url).toBe('https://review.example/api/review/have');
    expect((service.asked()!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer ingest-token-0123',
    );
    expect(JSON.parse(String(service.asked()!.init.body))).toEqual({
      digests: [bytesDigest(BASELINE), digestOf('AFTER')],
    });
    // The question comes first. Asking after the body was built would be asking
    // about work already done.
    expect(service.calls.map((call) => call.url.split('/api')[1])).toEqual([
      // Version first: it costs one request, it happens before anything is read
      // off disk, and it is the answer that explains how large the next two are.
      '/version',
      '/review/have',
      '/review/builds',
    ]);
  });

  it('names the bytes it does not have to send, and sends the rest', async () => {
    const { result, images } = await pushWith({ holds: [digestOf('AFTER')] });

    expect(images['after']).toMatchObject({ digest: digestOf('AFTER'), documentDigest: 'v1:abc' });
    expect(images['after']).not.toHaveProperty('bytes');
    // Not held, so it goes in full.
    expect(images['before']).toMatchObject({
      bytes: BASELINE.toString('base64'),
      width: 800,
      height: 600,
    });
    // Still both images on the build, whatever form they travelled in.
    expect(result.images).toEqual({ after: 1, before: 1 });
    expect(result.reused).toBe(1);
  });

  it('keeps measuring a baseline whose bytes stay at home', async () => {
    const held = bytesDigest(BASELINE);
    const { images } = await pushWith({ holds: [held] });

    // The size describes the reference, not the upload: a viewer drawing the two
    // layers needs it whether or not this push carried the pixels.
    expect(images['before']).toEqual({ digest: held, width: 800, height: 600 });
  });

  it('sends everything when the deployment does not answer the question', async () => {
    const { result, images } = await pushWith({ noHave: true });

    // A deployment older than this route is not a failed push; it is the push
    // this command made before the route existed.
    expect(images['after']).toMatchObject({ bytes: Buffer.from('AFTER', 'utf8').toString('base64') });
    expect(result.reused).toBe(0);
  });

  it('sends everything when the question itself throws', async () => {
    const service = surface();
    const refusing = (async (url: unknown, init: unknown) => {
      if (String(url).endsWith('/review/have')) throw new Error('ECONNRESET');
      return await service.fetch(url as string, init as RequestInit);
    }) as typeof globalThis.fetch;

    const result = await push(
      options({ report: report(NAMED), deps: { fetch: refusing, read } }),
    );

    expect(result.reused).toBe(0);
    expect(service.posted()).toBeDefined();
  });

  it('asks nothing when there is nothing to ask about', async () => {
    const service = surface();

    await push(options({ deps: { fetch: service.fetch, read: disk({}) } }));

    expect(service.asked()).toBeUndefined();
  });

  it('tells the operator what it did not have to upload', () => {
    expect(
      formatPush({
        build: 'b',
        endpoint: 'e',
        service: { known: true, api: 2 },
        elapsedMs: 1000,
        subjects: 1,
        images: { after: 1, before: 1 },
        reused: 2,
        bytes: 1024,
        withheld: [],
      }),
    ).toContain('2 image(s) were already there and went as digests');
  });
});
