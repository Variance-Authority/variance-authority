/**
 * What the service answers about the recorded builds, worked out again from
 * what was sent to it.
 *
 * `record.mjs` keeps the writes — the two pushes, the decisions, the concern —
 * because making them takes a browser. The answers are not kept as a memory of
 * one afternoon's service: they are what this function gets by replaying those
 * writes into a fresh `createTribunal` and reading every page's worth back
 * through `createReviewClient`. `test/recording.test.ts` runs it on every
 * `yarn test` and holds the result against `recorded/answers.json`, so a change
 * to what the service answers fails there, not silently under a photograph of
 * the old answer.
 *
 * The service, its doubles and its client are handed in rather than imported:
 * the test hands in `src/`, so it judges the code under review, and
 * `record.mjs` hands in `dist/`, which is all a plain Node script can load.
 */
import { createHash } from 'node:crypto';

/** The project the case is filed under, and the two credentials the recording uses. */
export const PROJECT = 'storybook-case';
export const INGEST = 'stories-ingest-token-0123456789';
export const REVIEW = 'stories-review-token-0123456789';

const ENDPOINT = 'https://tribunal.invalid';

/** An image's file in `recorded/images`, named for its bytes so the two builds share their baselines. */
export function imageName(bytes) {
  return `${createHash('sha256').update(bytes).digest('hex')}.png`;
}

/**
 * Replay the recorded writes, then read what the review page reads.
 *
 * @param recording `recorded/writes.json`: `{ at, writes: [{ at, as, method, path, body }] }`.
 * @param image The bytes of one file in `recorded/images`.
 * @param service `createTribunal`, `createSqliteD1`, `createMemoryR2` and `createReviewClient`.
 * @returns The answers by path, and the image each subject's layer is drawn from.
 */
export async function answersOf(recording, image, service) {
  // Every write is made at the hour it was recorded at, and every read at the
  // hour recording ended, so a decision's date and a window's edge come out the
  // same on every machine.
  let clock = new Date(recording.at);
  const db = await service.createSqliteD1();
  const tribunal = service.createTribunal({
    db,
    bucket: service.createMemoryR2(),
    project: PROJECT,
    ingestToken: INGEST,
    reviewToken: REVIEW,
    now: () => clock,
  });

  try {
    for (const write of recording.writes) {
      clock = new Date(write.at);
      const response = await tribunal.fetch(
        new Request(`${ENDPOINT}${write.path}`, {
          method: write.method,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${write.as === 'ingest' ? INGEST : REVIEW}`,
          },
          body: JSON.stringify(withBytes(write.body, image)),
        }),
      );
      if (!response.ok) {
        throw new Error(`${write.method} ${write.path} was refused on replay: ${response.status} ${await response.text()}`);
      }
    }
    clock = new Date(recording.at);

    const answers = {};
    const reading = async (input, init) => {
      const response = await tribunal.fetch(new Request(input, init));
      const url = new URL(response.url || String(input));
      if (!url.pathname.endsWith('.png')) {
        answers[`${url.pathname}${url.search}`] = { status: response.status, body: await response.clone().json() };
      }
      return response;
    };
    const client = service.createReviewClient({ endpoint: ENDPOINT, token: REVIEW, fetch: reading });
    const images = await read(client);
    return { answers: sorted(answers), images };
  } finally {
    db.close();
  }
}

/** A recorded push carries a file name where it sent bytes; put the bytes back. */
function withBytes(body, image) {
  if (body.images === undefined) return body;
  const images = {};
  for (const [subject, kinds] of Object.entries(body.images)) {
    images[subject] = {};
    for (const [kind, { file, ...rest }] of Object.entries(kinds)) {
      images[subject][kind] = file === undefined ? rest : { bytes: Buffer.from(image(file)).toString('base64'), ...rest };
    }
  }
  return { ...body, images };
}

/** Every read the review page makes for the recorded builds, so the replay answers each one. */
async function read(client) {
  const names = {};
  const builds = (await client.builds()).map((one) => one.build).sort();
  await client.changelog();
  for (const build of builds) {
    const detail = await client.build(build);
    await client.concerns({ seenIn: build });
    const components = new Set();
    for (const subject of detail.subjects) {
      await client.concerns({ subject: subject.subject });
      await client.flakiness(subject.subject);
      for (const region of subject.regions) if (region.component) components.add(region.component);
      for (const moved of subject.moved ?? []) components.add(moved.component);
      for (const kind of ['before', 'after', 'diff']) {
        if (!subject.has[kind]) continue;
        const bytes = new Uint8Array(await (await client.imageBlob(build, subject.subject, kind)).arrayBuffer());
        ((names[build] ??= {})[subject.subject] ??= {})[kind] = imageName(bytes);
      }
    }
    for (const component of [...components].sort()) {
      await client.changelog({ component });
      await client.churn(component);
      await client.reach(component);
    }
  }
  return names;
}

/** Keys in code-unit order, so the same answers are always the same file. */
function sorted(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
