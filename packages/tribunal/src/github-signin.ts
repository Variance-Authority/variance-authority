/**
 * `github` as a reviewer mechanism: a person proves who they are to GitHub, and
 * GitHub says whether they can write to the repository this deployment reviews.
 *
 * Write access is the rule because it is the one a repository already has: whoever
 * could merge the change may approve what it did to the pixels, nobody keeps a
 * second list, and removing someone from the repository removes them here within
 * one session.
 *
 * The session is a signed cookie holding a login and an expiry, and nothing else.
 * The token GitHub issued is used for the two reads below and discarded, so a
 * deployment holds no credential that works anywhere else. `SameSite=Lax` is what
 * keeps another site's form from deciding as the person signed in: the cookie does
 * not travel on a cross-site POST.
 */

import { bytes } from './issuer.js';

export const SIGN_IN_PATH = '/auth/github/login';
const CALLBACK_PATH = '/auth/github/callback';

const SESSION_COOKIE = 'variance_session';
const STATE_COOKIE = 'variance_state';

/** An hour, so a person who lost write access stops deciding within one. */
const SESSION_SECONDS = 3600;
const STATE_SECONDS = 600;

export interface GithubSignInOptions {
  /** `Owner/name`: the repository whose writers review here. */
  readonly repository: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Signs the session cookie. Rotating it signs everybody out. */
  readonly sessionSecret: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export interface GithubSignIn {
  /** Answers the sign-in routes, and `null` for every other path. */
  serve(request: Request): Promise<Response | null>;
  /** The login a valid session names, or `null`. */
  login(request: Request): Promise<string | null>;
}

export function createGithubSignIn(options: GithubSignInOptions): GithubSignIn {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const key = crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(options.sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  async function sealed(login: string): Promise<string> {
    const body = base64url(new TextEncoder().encode(JSON.stringify({ login, exp: now() / 1000 + SESSION_SECONDS })));
    const signature = await crypto.subtle.sign('HMAC', await key, new TextEncoder().encode(body));
    return `${body}.${base64url(new Uint8Array(signature))}`;
  }

  function begin(url: URL): Response {
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const target = new URL('https://github.com/login/oauth/authorize');
    target.searchParams.set('client_id', options.clientId);
    target.searchParams.set('redirect_uri', `${url.origin}${CALLBACK_PATH}`);
    target.searchParams.set('state', state);

    const back = base64url(new TextEncoder().encode(returnOf(url.searchParams.get('return'), url)));
    return new Response(null, {
      status: 302,
      headers: {
        location: target.href,
        'set-cookie': cookie(STATE_COOKIE, `${state}.${back}`, STATE_SECONDS, url),
      },
    });
  }

  async function finish(url: URL, request: Request): Promise<Response> {
    const [state, back] = (cookieOf(request, STATE_COOKIE) ?? '').split('.');
    if (state === undefined || state === '' || state !== url.searchParams.get('state')) {
      return refusal('This sign-in was not started here, or it took longer than ten minutes. Open the page again.');
    }

    const token = await exchanged(url);
    if (token === null) return refusal('GitHub did not accept this sign-in. Open the page again.');

    const login = await who(token);
    if (!(await writes(token))) {
      return refusal(`${login} cannot write to ${options.repository}, so this deployment does not take their decisions.`);
    }

    const headers = new Headers({ location: returnOf(new TextDecoder().decode(bytes(back ?? '') ?? new Uint8Array()), url) });
    headers.append('set-cookie', cookie(SESSION_COOKIE, await sealed(login), SESSION_SECONDS, url));
    headers.append('set-cookie', cookie(STATE_COOKIE, '', 0, url));
    return new Response(null, { status: 302, headers });
  }

  async function exchanged(url: URL): Promise<string | null> {
    const response = await send('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code: url.searchParams.get('code') ?? '',
        redirect_uri: `${url.origin}${CALLBACK_PATH}`,
      }),
    });
    if (!response.ok) throw new Error(`GitHub's token endpoint answered ${response.status}`);
    const { access_token: token } = (await response.json()) as { readonly access_token?: unknown };
    return typeof token === 'string' ? token : null;
  }

  function asked(path: string, token: string): Promise<Response> {
    return send(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'variance-authority-tribunal',
      },
    });
  }

  async function who(token: string): Promise<string> {
    const response = await asked('/user', token);
    if (!response.ok) throw new Error(`GitHub's /user answered ${response.status}`);
    const { login } = (await response.json()) as { readonly login?: unknown };
    if (typeof login !== 'string') throw new Error("GitHub's /user names no login");
    return login;
  }

  async function writes(token: string): Promise<boolean> {
    const response = await asked(`/repos/${options.repository}`, token);
    // GitHub hides a private repository from a reader who cannot see it.
    if (response.status === 403 || response.status === 404) return false;
    if (!response.ok) throw new Error(`GitHub's /repos/${options.repository} answered ${response.status}`);
    const { permissions } = (await response.json()) as { readonly permissions?: { readonly push?: unknown } };
    return permissions?.push === true;
  }

  return {
    async serve(request) {
      const url = new URL(request.url);
      if (request.method !== 'GET') return null;
      if (url.pathname === SIGN_IN_PATH) return begin(url);
      if (url.pathname === CALLBACK_PATH) return finish(url, request);
      return null;
    },

    async login(request) {
      const [body, signature] = (cookieOf(request, SESSION_COOKIE) ?? '').split('.');
      if (body === undefined || signature === undefined || body === '') return null;
      const presented = bytes(signature);
      const sealedBody = bytes(body);
      if (presented === null || sealedBody === null) return null;
      const signed = new TextEncoder().encode(body);
      if (!(await crypto.subtle.verify('HMAC', await key, presented as BufferSource, signed))) return null;

      const session = JSON.parse(new TextDecoder().decode(sealedBody)) as {
        readonly login: string;
        readonly exp: number;
      };
      return session.exp > now() / 1000 ? session.login : null;
    },
  };
}

/** Only a path on this deployment: a sign-in must not be a way to send somebody elsewhere. */
function returnOf(path: string | null, url: URL): string {
  // Resolved the way the browser will resolve it, which drops tabs and newlines
  // and reads a backslash as a slash.
  if (path === null || !path.startsWith('/') || !URL.canParse(path, url.origin)) return '/';
  const target = new URL(path, url.origin);
  return target.origin === url.origin ? `${target.pathname}${target.search}${target.hash}` : '/';
}

function refusal(sentence: string): Response {
  return new Response(`${sentence}\n`, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function cookie(name: string, value: string, seconds: number, url: URL): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`;
}

export function cookieOf(request: Request, name: string): string | null {
  for (const pair of (request.headers.get('cookie') ?? '').split(';')) {
    const [found, ...rest] = pair.trim().split('=');
    if (found === name && rest.length > 0) return rest.join('=');
  }
  return null;
}

function base64url(view: Uint8Array): string {
  return btoa(String.fromCharCode(...view)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
