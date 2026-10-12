/**
 * The recording `record.mjs` made, answered again.
 *
 * The client is the real `createReviewClient`, handed a `fetch` that looks each
 * request up in `recorded/answers.json` instead of sending it. So a story sees
 * what the service said, decoded by the code that decodes it on a reviewer's
 * page, and a request the recording does not hold is a 404 with the path in it
 * — a story that asks for something nobody recorded says so on the page rather
 * than drawing an empty panel that looks like an answer.
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

/** The review client over the recording. */
export function replayClient(): ReviewClient {
  const replay = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? 'GET';
    const key = `${url.pathname}${url.search}`;
    if (method !== 'GET') return answer(405, { error: `${method} ${key} is a write, and a recording holds none` });

    const image = IMAGE.exec(url.pathname);
    if (image !== null) {
      const [, build = '', subject = '', kind = ''] = image;
      const served = imageOf(decodeURIComponent(build), decodeURIComponent(subject), kind);
      return served === undefined ? answer(404, { error: `no ${kind} image was recorded for ${key}` }) : fetch(served);
    }

    const recorded = RECORDED.answers[key];
    if (recorded === undefined) return answer(404, { error: `nothing was recorded for GET ${key}` });
    return answer(recorded.status, recorded.body);
  };

  const client = createReviewClient({ endpoint: ENDPOINT, fetch: replay });
  // `imageUrl` is for an `<img src>`, which never passes through `fetch`.
  return { ...client, imageUrl: (build, subject, kind) => imageOf(build, subject, kind) ?? `${ENDPOINT}/missing.png` };
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

/** One subject of a recorded build, by the end of its id. */
export function subjectOf(build: string, ending: string): SubjectView {
  const found = buildOf(build).subjects.find((one) => one.subject.endsWith(ending));
  if (found === undefined) throw new Error(`${build} recorded no subject ending in ${ending}`);
  return found;
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
