// The GitHub API as the action's scripts speak it: one request, and one walk of
// a pull request's comments. No SDK, for the reason `post-comment.mjs` gives.
//
// What a failure means is the caller's. A comment the token may not write is a
// warning to the poster and a failed tick to `tick.mjs`, so `refused` and `fail`
// are parameters: without them, a failure throws.

const API_VERSION = '2022-11-28';

export const PER_PAGE = 100;

/**
 * Pages of comments this will read before refusing to guess.
 *
 * A pull request with more than five thousand comments is pathological, and the
 * important part is what happens at the boundary: this stops and says so rather
 * than concluding "no such comment". That conclusion posts a duplicate, or drops
 * a tick, which is the silent-failure shape the whole design is arranged against.
 */
const MAX_PAGES = 50;

const thrown = (message) => {
  throw new Error(message);
};

export function forge({ refused, fail = thrown } = {}) {
  const api = (process.env['GITHUB_API_URL'] ?? 'https://api.github.com').replace(/\/+$/, '');
  const repository = `${api}/repos/${process.env['GITHUB_REPOSITORY']}`;

  async function request(method, path, payload) {
    const url = `${repository}/${path}`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${process.env['GITHUB_TOKEN']}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': API_VERSION,
          'user-agent': 'variance-authority-action',
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch (error) {
      fail(`${method} ${url} could not be sent: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (refused && (response.status === 403 || response.status === 404)) {
      return refused(method, url, response.status);
    }
    if (!response.ok) fail(`${method} ${url} failed: ${response.status} ${await response.text()}`);

    const text = await response.text();
    return text === '' ? undefined : JSON.parse(text);
  }

  /** Every page of `pull`'s comments, or a failure: never an early "that was all". */
  async function* commentPages(pull) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const comments = await request('GET', `issues/${pull}/comments?per_page=${PER_PAGE}&page=${page}`);
      if (!Array.isArray(comments)) fail(`the comments endpoint returned ${typeof comments}, not a list`);
      yield comments;
      if (comments.length < PER_PAGE) return;
    }
    fail(
      `this pull request has more than ${MAX_PAGES * PER_PAGE} comments and no marker was found ` +
        'in them. Refusing to conclude that there is no such comment.',
    );
  }

  return { request, commentPages };
}
