// The one door to GitHub and to the review service, and the one way to wait.
//
// `fetch` and nothing else, like `variance-accept.mjs`: a dependency here would
// be a third party between the driver and the thing it is testing. Every
// request names the secret it bears and the permission it needs, so a refusal
// arrives as a sentence about a credential rather than as a status code.

const API_VERSION = '2022-11-28';

/**
 * A failure the driver reports as it is: sentences, no stack. `status` is the
 * HTTP status when a request was refused, so a caller can tell a missing thing
 * from a forbidden one.
 */
export class Refusal extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * A client for one host bearing one token.
 *
 * `secret` is the name the token has in the workflow's secrets, used only in
 * messages. A request that comes back 401, 403 or 404 on a call that names
 * `needs` fails with the secret and that permission in the sentence, because
 * GitHub answers a token that may not see a repository with the same 404 it
 * gives a repository that does not exist.
 */
export function client({ base, token, secret, github = true }) {
  const root = base.replace(/\/+$/, '');
  return async function request(method, path, { body, needs, raw = false } = {}) {
    const headers = github
      ? { accept: 'application/vnd.github+json', 'x-github-api-version': API_VERSION }
      : { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${root}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const text = await response.text();
      const said = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      const denied = [401, 403, 404].includes(response.status) && needs !== undefined;
      throw new Refusal(
        `${method} ${root}${path} answered ${response.status}: ${said}` +
          (denied ? `. ${secret} needs ${needs}` : ''),
        response.status,
      );
    }
    if (raw) return response.text();
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text === '' ? undefined : JSON.parse(text);
  };
}

/**
 * Asks `probe` until it returns something other than `undefined`, or the
 * deadline passes.
 *
 * Bounded and never retried: the deadline is the whole budget for one wait, and
 * a probe that throws ends the wait with its own failure. `waiting` is the
 * sentence the timeout says, naming what never happened.
 */
export async function until(probe, { seconds, every, waiting }) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const found = await probe();
    if (found !== undefined) return found;
    if (Date.now() + every * 1000 > deadline) {
      throw new Refusal(`timed out after ${seconds}s: ${waiting}`);
    }
    await new Promise((done) => setTimeout(done, every * 1000));
  }
}
