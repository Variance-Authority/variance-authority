import { describe, expect, it } from 'vitest';
import { createGithubSignIn, SIGN_IN_PATH } from './github-signin.js';

const ORIGIN = 'https://tribunal.example';
const NOW = 1_800_000_000_000;

interface Github {
  readonly login?: string;
  readonly repository?: { status: number; body?: unknown };
  readonly exchange?: unknown;
}

function signIn(github: Github = {}, now: () => number = () => NOW) {
  return createGithubSignIn({
    repository: 'Owner/name',
    clientId: 'client',
    clientSecret: 'client-secret',
    sessionSecret: 'a-session-secret-of-some-length',
    now,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/login/oauth/access_token')) return Response.json(github.exchange ?? { access_token: 'gho_x' });
      if (url.endsWith('/user')) return Response.json({ login: github.login ?? 'someone' });
      const { status, body } = github.repository ?? { status: 200, body: { permissions: { push: true } } };
      return new Response(JSON.stringify(body ?? {}), { status });
    },
  });
}

async function started(flow: ReturnType<typeof signIn>, back = '/builds/7') {
  const response = await flow.serve(new Request(`${ORIGIN}${SIGN_IN_PATH}?return=${encodeURIComponent(back)}`));
  const cookie = response?.headers.get('set-cookie')?.split(';')[0] ?? '';
  const state = new URL(response?.headers.get('location') ?? '').searchParams.get('state') ?? '';
  return { response, cookie, state };
}

async function finished(flow: ReturnType<typeof signIn>, back?: string) {
  const { cookie, state } = await started(flow, back);
  return (await flow.serve(
    new Request(`${ORIGIN}/auth/github/callback?code=c&state=${state}`, { headers: { cookie } }),
  )) as Response;
}

function session(response: Response): string {
  const found = response.headers.getSetCookie().find((line) => line.startsWith('variance_session='));
  return found?.split(';')[0] ?? '';
}

describe('github sign-in', () => {
  it('sends the browser to GitHub with this deployment as the way back', async () => {
    const { response } = await started(signIn());
    const target = new URL(response?.headers.get('location') ?? '');

    expect(target.origin + target.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(target.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/github/callback`);
    expect(response?.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  });

  it('gives a writer a session named for their login, and returns them where they were', async () => {
    const flow = signIn({ login: 'marina' });
    const response = await finished(flow);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/builds/7');
    expect(await flow.login(new Request(ORIGIN, { headers: { cookie: session(response) } }))).toBe('marina');
  });

  it.each([
    ['a reader of the repository', { status: 200, body: { permissions: { push: false } } }],
    ['somebody GitHub hides the repository from', { status: 404 }],
  ])('refuses %s by name and gives no session', async (_name, repository) => {
    const response = await finished(signIn({ login: 'passerby', repository }));

    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/passerby cannot write to Owner\/name/);
    expect(session(response)).toBe('');
  });

  it('reports a GitHub failure as a failure, never as somebody without access', async () => {
    await expect(finished(signIn({ repository: { status: 502 } }))).rejects.toThrow(/502/);
  });

  it('refuses a callback whose state this browser never held', async () => {
    const flow = signIn();
    const { cookie } = await started(flow);

    const response = await flow.serve(
      new Request(`${ORIGIN}/auth/github/callback?code=c&state=forged`, { headers: { cookie } }),
    );

    expect(response?.status).toBe(403);
  });

  it('refuses a code GitHub does not accept', async () => {
    const response = await finished(signIn({ exchange: { error: 'bad_verification_code' } }));

    expect(response.status).toBe(403);
  });

  it.each(['//else.example', 'https://else.example', '/\\else.example', '/\t/else.example', '/\n/else.example', '/\r\\else.example'])('never returns to %s', async (back) => {
    expect((await finished(signIn(), back)).headers.get('location')).toBe('/');
  });

  it('does not read a session past its hour, or one somebody edited', async () => {
    let at = NOW;
    const flow = signIn({ login: 'marina' }, () => at);
    const cookie = session(await finished(flow));
    const [name, sealed] = cookie.split('=') as [string, string];
    const forged = `${name}=${btoa(JSON.stringify({ login: 'else', exp: 9e9 })).replaceAll('=', '')}.${sealed.split('.')[1]}`;

    expect(await flow.login(new Request(ORIGIN, { headers: { cookie: forged } }))).toBeNull();

    at += 3601_000;
    expect(await flow.login(new Request(ORIGIN, { headers: { cookie } }))).toBeNull();
  });

  it.each(['variance_session=@@@.@@@', 'variance_session=e30.@@@', 'variance_session=@@@.e30'])(
    'reads %s as nobody rather than failing',
    async (cookie) => {
      expect(await signIn().login(new Request(ORIGIN, { headers: { cookie } }))).toBeNull();
    },
  );

  it('answers nothing for any other path', async () => {
    expect(await signIn().serve(new Request(`${ORIGIN}/review/builds`))).toBeNull();
  });
});
