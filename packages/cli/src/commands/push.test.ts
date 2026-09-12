import { describe, expect, it } from 'vitest';
import { OperatorError } from '../exit.js';
import { push, type PushProgress } from './push.js';
import { formatPush } from './push-progress.js';
import { REVIEW, disk, header, options, report, surface, SIDECAR } from './push-fixture.js';

/**
 * What reaches a review surface, and what is deliberately kept back.
 *
 * No network and no disk: the fetch and the reader are both injected, so what
 * these assert is the *body* — which is the whole of what this command decides.
 * Everything else about it is one POST; the surface and the disk it is given are
 * in [`push-fixture.ts`](./push-fixture.ts).
 */

describe('putting a finished run in front of a reviewer', () => {
  it('posts the build to the ingest route, bearing the token it was given', async () => {
    const service = surface();

    await push(options({ deps: { fetch: service.fetch, read: disk({}) }, branch: 'main' }));

    expect(service.posted()?.url).toBe('https://review.example/api/review/builds');
    expect(service.posted()?.init.method).toBe('POST');
    expect((service.posted()!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer ingest-token-0123',
    );
    expect(service.sent()).toMatchObject({ build: 'github-9-1', commit: 'abc123', branch: 'main' });
  });

  it('joins the endpoint to the route without doubling the slash', async () => {
    const service = surface();

    await push(
      options({
        review: { ...REVIEW, endpoint: 'https://review.example/api/' },
        deps: { fetch: service.fetch, read: disk({}) },
      }),
    );

    expect(service.posted()?.url).toBe('https://review.example/api/review/builds');
  });

  it('sends the candidate with the sidecar that makes it approvable', async () => {
    const service = surface();

    const result = await push(
      options({
        report: report({ after: 'images/card.after.png', before: 'images/card.before.png', diff: 'images/card.diff.png' }),
        deps: {
          fetch: service.fetch,
          read: disk({
            '/out/images/card.after.png': 'AFTER',
            '/out/images/card.after.json': SIDECAR,
            '/out/images/card.before.png': 'BEFORE',
            '/out/images/card.diff.png': 'DIFF',
          }),
        },
      }),
    );

    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)['story:card']!;
    expect(images['after']).toEqual({
      bytes: Buffer.from('AFTER', 'utf8').toString('base64'),
      documentDigest: 'v1:abc',
      identity: { engine: 'chromium' },
      width: 800,
      height: 600,
      missingFonts: [],
    });
    expect(images['before']).toEqual({ bytes: Buffer.from('BEFORE', 'utf8').toString('base64') });
    // The report names a mask and this sends none: the surface holds both
    // captures and makes its own, and a mask never matches a digest anybody
    // already holds, so uploading one is pure cost on every run forever.
    expect(images['diff']).toBeUndefined();
    expect(result.images).toEqual({ after: 1, before: 1 });
    expect(result.withheld).toEqual([]);
  });

  it('measures the baseline it is sending, because its size is sometimes the change', async () => {
    // The candidate's dimensions come from a sidecar the run wrote. The baseline
    // has no sidecar — it is a file that arrived from a previous run, possibly a
    // previous version of this tool — so its size is read from its own header.
    // Without it a viewer has one pair of numbers for two images and draws both
    // to it, which turns a page that got 80 pixels wider into a hairline.
    const service = surface();
    const baseline = header(1200, 8868);

    await push(
      options({
        report: report({ after: 'images/card.after.png', before: 'images/card.before.png' }),
        deps: {
          fetch: service.fetch,
          read: async (path: string): Promise<Buffer> => {
            if (path === '/out/images/card.before.png') return baseline;
            if (path === '/out/images/card.after.json') return Buffer.from(SIDECAR, 'utf8');
            return Buffer.from('AFTER', 'utf8');
          },
        },
      }),
    );

    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)[
      'story:card'
    ]!;

    expect(images['before']).toMatchObject({ width: 1200, height: 8868 });
    // And the candidate's own numbers still come from the sidecar, which is a
    // claim about the *document*, not about the file.
    expect(images['after']).toMatchObject({ width: 800, height: 600 });
  });

  it('says nothing about the size of a baseline it could not read as a PNG', async () => {
    // Absent, not zero, and not the candidate's. A number here that nobody
    // measured would arrive on the review page next to ones that were, in the
    // same typeface, and there would be no way to tell them apart.
    const service = surface();

    await push(
      options({
        report: report({ before: 'images/card.before.png' }),
        deps: {
          fetch: service.fetch,
          read: disk({ '/out/images/card.before.png': '<html>404 Not Found</html>' }),
        },
      }),
    );

    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)[
      'story:card'
    ]!;

    expect(images['before']).toEqual({
      bytes: Buffer.from('<html>404 Not Found</html>', 'utf8').toString('base64'),
    });
  });

  it('withholds a candidate whose sidecar is missing, rather than inventing its digest', async () => {
    const service = surface();

    const result = await push(
      options({
        report: report({ after: 'images/card.after.png', before: 'images/card.before.png' }),
        deps: {
          fetch: service.fetch,
          // The PNG is there. The sidecar is not, and the digest is only in it.
          read: disk({ '/out/images/card.after.png': 'AFTER', '/out/images/card.before.png': 'BEFORE' }),
        },
      }),
    );

    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)['story:card']!;
    expect(images['after']).toBeUndefined();
    // The subject still goes up and can still be looked at. What it loses is the
    // button, and the reason is said here rather than discovered on the page.
    expect(images['before']).toBeDefined();
    expect(result.withheld).toEqual([
      {
        subject: 'story:card',
        kind: 'after',
        because: expect.stringContaining('/out/images/card.after.json could not be read'),
      },
    ]);
    expect(formatPush(result)).toContain('[withheld] story:card after');
  });

  it('withholds a candidate whose sidecar carries no digest', async () => {
    const service = surface();

    const result = await push(
      options({
        report: report({ after: 'images/card.after.png' }),
        deps: {
          fetch: service.fetch,
          read: disk({
            '/out/images/card.after.png': 'AFTER',
            '/out/images/card.after.json': JSON.stringify({ width: 800, height: 600 }),
          }),
        },
      }),
    );

    expect(result.withheld[0]?.because).toContain('never approved');
  });

  it('sends no `images` key at all when the run kept none', async () => {
    const service = surface();

    await push(options({ deps: { fetch: service.fetch, read: disk({}) } }));

    expect(service.sent()['images']).toBeUndefined();
  });

  it('reports a refusal as an operator error carrying what the surface said', async () => {
    const service = surface({ status: 403, body: 'ingest requires the ingest token' });

    await expect(
      push(options({ deps: { fetch: service.fetch, read: disk({}) } })),
    ).rejects.toThrow(/403 Forbidden.*ingest requires the ingest token/s);
  });

  it('says the report survived when the surface could not be reached', async () => {
    const unreachable = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof globalThis.fetch;

    const failure = push(options({ deps: { fetch: unreachable, read: disk({}) } }));
    await expect(failure).rejects.toThrow(OperatorError);
    await expect(failure).rejects.toThrow(/may be run again against it/);
  });
});

describe('saying where a push has got to', () => {
  /** A report naming one image per subject, so the count is the subject count. */
  function many(subjects: readonly string[]): CliRunReport {
    return {
      ...report(),
      observations: subjects.map((subject) => ({
        subject,
        verdict: 'unchanged',
        because: 'nothing moved',
        changedPixels: 0,
        regions: [],
        images: { after: `images/${subject}.after.png` },
      })),
    } as unknown as CliRunReport;
  }

  function files(subjects: readonly string[]): Record<string, string> {
    return Object.fromEntries(
      subjects.flatMap((subject) => [
        [`/out/images/${subject}.after.png`, 'png'],
        [`/out/images/${subject}.after.json`, SIDECAR],
      ]),
    );
  }

  it('counts the subjects that carry images, and opens the phase before the first one', async () => {
    const subjects = ['a', 'b'];
    const seen: PushProgress[] = [];
    const posted = surface();

    await push(
      options({
        report: {
          ...many(subjects),
          // A third subject with nothing to send. It is not in the denominator,
          // because a push that reads two files must not report itself as
          // two-thirds done and then finish.
          observations: [
            ...(many(subjects).observations as unknown[]),
            { subject: 'c', verdict: 'unchanged', because: '', changedPixels: 0, regions: [] },
          ],
        } as unknown as CliRunReport,
        onProgress: (event) => seen.push(event),
        deps: { read: disk(files(subjects)), fetch: posted.fetch },
      }),
    );

    expect(seen.map((event) => (event.phase === 'encoding' ? `${event.done}/${event.total}` : event.phase))).toEqual([
      // First, before a byte is read: what this deployment is, which is the
      // fact that explains everything the rest of these phases do.
      'service',
      '0/2',
      '1/2',
      '2/2',
      'asking',
      'sending',
    ]);
  });

  it('grows the byte count as it encodes, and reports the whole body when it sends', async () => {
    const subjects = ['a', 'b'];
    const seen: PushProgress[] = [];
    const posted = surface();

    await push(
      options({
        report: many(subjects),
        onProgress: (event) => seen.push(event),
        deps: { read: disk(files(subjects)), fetch: posted.fetch },
      }),
    );

    // The asking phase has no size — it is one question — so it is not in the
    // series the byte count has to climb through.
    const sized = seen.filter((event) => event.phase !== 'asking' && event.phase !== 'service');
    const bytes = sized.map((event) => event.bytes);
    // Monotonic, and the send is larger than the images alone: the report goes
    // up with them.
    expect(bytes).toEqual([...bytes].sort((a, b) => a - b));
    expect(bytes[0]).toBe(0);
    expect(seen.at(-1)).toEqual({ phase: 'sending', bytes: expect.any(Number) });
    expect(seen.at(-1)?.bytes).toBeGreaterThan(bytes[2] ?? 0);
  });

  it('costs nothing to a caller that did not ask', async () => {
    // The events are computed inside the loop, so a push with no listener has to
    // be a push that still works — this is the shape every other test here runs.
    const posted = surface();
    const result = await push(
      options({ report: many(['a']), deps: { read: disk(files(['a'])), fetch: posted.fetch } }),
    );

    expect(result.images.after).toBe(1);
  });
});

describe('the sidecar a promotion will be made from', () => {
  /**
   * The three fields a push used to read past.
   *
   * Each of them is written by the run beside the PNG, survives the local
   * durable store, and is read by a *later* run off whatever baseline this
   * candidate becomes. Dropping one in transit does not fail anything here: it
   * makes the review surface the lossy way to approve an image, and the loss
   * shows up a week later as a cause ranked by area or a standing defect
   * reported as new.
   */
  const FULL = JSON.stringify({
    documentDigest: 'v1:abc',
    identity: { renderer: 'playwright-chromium', deviceScaleFactor: 2 },
    width: 1600,
    height: 1200,
    missingFonts: ['Inter'],
    components: [{ component: 'Card', instances: 1, structure: 's', semantics: 'm', text: 't', style: 'y' }],
    findingMarks: ['a control inside another control'],
  });

  async function sentCandidate(sidecar: string): Promise<Record<string, unknown> | undefined> {
    const service = surface();
    await push(
      options({
        report: report({ after: 'images/card.after.png' }),
        deps: {
          fetch: service.fetch,
          read: disk({ '/out/images/card.after.png': 'AFTER', '/out/images/card.after.json': sidecar }),
        },
      }),
    );
    const images = service.sent()['images'] as Record<string, Record<string, unknown>> | undefined;
    return images?.['story:card']?.['after'] as Record<string, unknown> | undefined;
  }

  it('carries the identity the document was painted under, not the run\'s', async () => {
    // The run's identity describes the machine and leaves the scale at 1 — the
    // renderer says so where it sets it. Every baseline lookup keys on the
    // per-document identity instead, so a promotion given only the machine one
    // files a 2x baseline under a digest no run asks for: approved, recorded,
    // and never found again.
    expect((await sentCandidate(FULL))?.['identity']).toEqual({
      renderer: 'playwright-chromium',
      deviceScaleFactor: 2,
    });
  });

  it('carries the component hashes and the finding marks', async () => {
    const after = await sentCandidate(FULL);

    expect(after?.['components']).toEqual([
      { component: 'Card', instances: 1, structure: 's', semantics: 'm', text: 't', style: 'y' },
    ]);
    expect(after?.['findingMarks']).toEqual(['a control inside another control']);
  });

  it('leaves absent fields absent rather than sending an empty answer', async () => {
    // `[]` is a claim: this render was read and had nothing. A sidecar that
    // never carried the field made no claim, and `promote` writes whatever
    // arrives onto the baseline — where the difference is whether a later run
    // says "no components declared" or "nothing recorded".
    const after = await sentCandidate(SIDECAR);

    expect(after).not.toHaveProperty('components');
    expect(after).not.toHaveProperty('findingMarks');
  });

  it('withholds a candidate whose sidecar never said which fonts were missing', async () => {
    // Rather than sending `[]`. The field is the one the store refuses a sidecar
    // for lacking, and an invented "nothing was missing" is written onto the
    // baseline as fact by the approval.
    const service = surface();
    const result = await push(
      options({
        report: report({ after: 'images/card.after.png' }),
        deps: {
          fetch: service.fetch,
          read: disk({
            '/out/images/card.after.png': 'AFTER',
            '/out/images/card.after.json': JSON.stringify({ documentDigest: 'v1:abc', width: 8, height: 6 }),
          }),
        },
      }),
    );

    expect(result.withheld[0]?.because).toContain('missingFonts');
    expect(result.images.after).toBe(0);
  });
});
