/**
 * The recording `record.mjs` made, answered again.
 *
 * The client is the real `createReviewClient`, handed a `fetch` that looks each
 * request up in `recorded/answers.json` instead of sending it. So a story sees
 * what the service said, decoded by the code that decodes it on a reviewer's
 * page.
 *
 * A request the recording does not hold is a 404 with the path in it, and it
 * fails the story: {@link replayed} is every story's play function, and it
 * throws once the page has gone quiet if anything was asked that nobody
 * recorded. The collector reads a play function that threw as a story that did
 * not render, so a panel drawn over a miss is a hole in the run, never a
 * baseline that looks like an answer.
 *
 * Writes are not replayed. A recording of a decision is a decision that already
 * happened, and answering a second one as if it had been made would make a
 * story of an approve button that lies.
 */
import { createReviewClient, type ReviewClient } from '../src/ui/client.js';
import type { BuildDetail, BuildSummary, SubjectView } from '../src/review-types.js';
import recording from './recorded/answers.json' with { type: 'json' };

interface Recorded {
  readonly answers: Readonly<Record<string, { readonly status: number; readonly body: unknown }>>;
  readonly images: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>;
}

const RECORDED = recording as unknown as Recorded;
const ENDPOINT = 'https://tribunal.invalid';
const IMAGE = /^\/review\/builds\/([^/]+)\/subjects\/([^/]+)\/(before|after|diff)\.png$/;

/** Where Storybook serves one recorded image, or `undefined` when none was recorded. */
export function imageOf(build: string, subject: string, kind: string): string | undefined {
  const file = RECORDED.images[build]?.[subject]?.[kind];
  return file === undefined ? undefined : `/recorded/${file}`;
}

/**
 * What the current story asked for and the recording did not hold, and how many
 * of its requests are still being answered. Module state because every story's
 * client is one of these, and Storybook shows one story at a time.
 */
const missed: string[] = [];
let answering = 0;

/** Start a story with nothing missed. Storybook's `beforeEach`, set in `.storybook/preview.tsx`. */
export function forgetMisses(): void {
  missed.length = 0;
}

/**
 * Wait for the replay to go quiet, then fail if the story asked for anything
 * that was not recorded.
 *
 * Quiet is no request in flight and nothing on the page saying `aria-busy`
 * across three frames in a row, which is long enough for an answer to be
 * committed and for the request it causes to be made. A story that is still
 * asking or still busy after five seconds fails too: a page that never settles
 * has no state to photograph.
 *
 * The requests alone are not the page's work. A difference mask is made from
 * two answers after both have arrived — a decode, a comparison and an encode —
 * and drawn from an object URL, so the count reads zero for the whole of it and
 * no image node exists for the collector's own wait to find. The crop and the
 * viewer say `aria-busy` while that runs, and this waits for them.
 *
 * Three frames are a bound, not a proof: a request a component makes only after
 * a timer, or after this returns, is not counted, and its miss is photographed
 * as whatever the component draws for a 404.
 */
export async function replayed(): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (let still = 0; still < 3; ) {
    await new Promise((done) => requestAnimationFrame(done));
    const busy = document.querySelectorAll('[aria-busy="true"]').length;
    still = answering === 0 && busy === 0 ? still + 1 : 0;
    if (Date.now() > deadline) {
      throw new Error(
        `the replay was still answering ${answering} requests, with ${busy} element(s) busy, after five seconds`,
      );
    }
  }
  if (missed.length > 0) {
    throw new Error(`the recording holds no answer for ${missed.join(', ')}; run stories/record.mjs or ask for what it holds`);
  }
}

/** The review client over the recording. */
export function replayClient(): ReviewClient {
  const replay = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    answering += 1;
    try {
      return await answerFor(input, init);
    } finally {
      answering -= 1;
    }
  };

  const answerFor = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? 'GET';
    const key = `${url.pathname}${url.search}`;
    if (method !== 'GET') return answer(405, { error: `${method} ${key} is a write, and a recording holds none` });

    const image = IMAGE.exec(url.pathname);
    if (image !== null) {
      const [, build = '', subject = '', kind = ''] = image;
      const served = imageOf(decodeURIComponent(build), decodeURIComponent(subject), kind);
      if (served !== undefined) return fetch(served);
      missed.push(`GET ${key}`);
      return answer(404, { error: `no ${kind} image was recorded for ${key}` });
    }

    const recorded = RECORDED.answers[key];
    if (recorded === undefined) {
      missed.push(`GET ${key}`);
      return answer(404, { error: `nothing was recorded for GET ${key}` });
    }
    return answer(recorded.status, recorded.body);
  };

  const client = createReviewClient({ endpoint: ENDPOINT, fetch: replay });
  // `imageUrl` is for an `<img src>`, which never passes through `fetch`.
  const imageUrl: ReviewClient['imageUrl'] = (build, subject, kind) => {
    const served = imageOf(build, subject, kind);
    if (served !== undefined) return served;
    missed.push(`the ${kind} image of ${subject} in ${build}`);
    return `${ENDPOINT}/missing.png`;
  };
  return { ...client, imageUrl };
}

/** One recorded answer, as the service sent it. */
export function recorded<T>(path: string): T {
  const one = RECORDED.answers[path];
  if (one === undefined) throw new Error(`nothing was recorded for GET ${path}; run stories/record.mjs`);
  return one.body as T;
}

/** The builds the recording holds: the first run of the case, and the one after the mutation. */
export const BASE = 'ci-101';
export const CHANGED = 'ci-102';

export const buildOf = (build: string): BuildDetail => recorded<BuildDetail>(`/review/builds/${build}`);
export const summaries = (): readonly BuildSummary[] => recorded<{ builds: BuildSummary[] }>('/review/builds').builds;

/** One subject of a recorded build, by its id. */
export function subjectOf(build: string, subject: string): SubjectView {
  const found = buildOf(build).subjects.find((one) => one.subject === subject);
  if (found === undefined) throw new Error(`${build} recorded no subject ${subject}`);
  return found;
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
