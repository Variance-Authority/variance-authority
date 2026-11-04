import { describe, expect, it } from 'vitest';
import { manifest, registerApp, type AppRequest } from './github-app.js';

const REQUEST: AppRequest = { name: 'shop-tribunal', host: 'tribunal.example.dev' };

/** A browser that confirms the page GitHub shows and follows it home. */
function person(after: (local: string, state: string) => Promise<void>) {
  return async (url: string) => {
    const page = await (await fetch(url)).text();
    const state = /state=([0-9a-f]+)/.exec(page)![1]!;
    await after(new URL(url).origin, state);
  };
}

const handoff = { say: () => {}, created: async () => {} };

const converted = (async () =>
  new Response(JSON.stringify({ client_id: 'Iv1.x', client_secret: 'shh', slug: 'shop-tribunal' }), {
    status: 201,
  })) as unknown as typeof fetch;

describe('the App manifest', () => {
  const made = manifest(REQUEST, 'http://127.0.0.1:9');

  it('returns a person to the deployment after sign-in and to this run after setup', () => {
    expect(made['callback_urls']).toEqual(['https://tribunal.example.dev/auth/github/callback']);
    expect(made['redirect_url']).toBe('http://127.0.0.1:9/created');
    expect(made['setup_url']).toBe('http://127.0.0.1:9/installed');
  });

  it('asks for nothing but metadata, and for no webhook', () => {
    expect(made['default_permissions']).toEqual({ metadata: 'read' });
    expect(made['hook_attributes']).toEqual({ url: 'https://tribunal.example.dev', active: false });
  });

  it('is public, so a collaborator outside the organization can authorize it', () => {
    expect(made['public']).toBe(true);
  });

  it('fits GitHub’s limit on a name', () => {
    expect((manifest({ ...REQUEST, name: 'x'.repeat(40) }, '')['name'] as string).length).toBe(34);
  });
});

describe('registerApp', () => {
  it('answers with the credentials once the App is made and installed', async () => {
    let installPage: string | null = null;
    const app = await registerApp(REQUEST, {
      ...handoff,
      fetch: converted,
      open: person(async (local, state) => {
        const created = await fetch(`${local}/created?state=${state}&code=abc`, { redirect: 'manual' });
        installPage = created.headers.get('location');
        await fetch(`${local}/installed?installation_id=1&state=${state}`);
      }),
    });

    expect(app).toEqual({ clientId: 'Iv1.x', clientSecret: 'shh', slug: 'shop-tribunal' });
    expect(installPage).toMatch(/^https:\/\/github\.com\/apps\/shop-tribunal\/installations\/new\?state=[0-9a-f]+$/);
  });

  it('hands over the credentials before the install page, since GitHub shows them once', async () => {
    const kept: string[] = [];
    await registerApp(REQUEST, {
      say: () => {},
      created: async (app) => void kept.push(app.clientSecret),
      fetch: converted,
      open: person(async (local, state) => {
        await fetch(`${local}/created?state=${state}&code=abc`, { redirect: 'manual' });
        expect(kept).toEqual(['shh']);
        await fetch(`${local}/installed?state=${state}`);
      }),
    });
  });

  it('fails when the credentials could not be kept, rather than sending the person on', async () => {
    await expect(
      registerApp(REQUEST, {
        say: () => {},
        created: async () => {
          throw new Error('wrangler refused');
        },
        fetch: converted,
        open: person(async (local, state) => {
          await fetch(`${local}/created?state=${state}&code=abc`, { redirect: 'manual' });
        }),
      }),
    ).rejects.toThrow('wrangler refused');
  });

  it('refuses an install that came back with another state, and keeps waiting', async () => {
    let refused = 0;
    await registerApp(REQUEST, {
      ...handoff,
      fetch: converted,
      open: person(async (local, state) => {
        await fetch(`${local}/created?state=${state}&code=abc`, { redirect: 'manual' });
        refused = (await fetch(`${local}/installed?state=forged`)).status;
        await fetch(`${local}/installed?state=${state}`);
      }),
    });
    expect(refused).toBe(404);
  });

  it('posts the manifest to the organization that owns the repository', async () => {
    let page = '';
    await registerApp(
      { ...REQUEST, organization: 'acme' },
      {
        ...handoff,
        fetch: converted,
        open: async (url) => {
          page = await (await fetch(url)).text();
          const local = new URL(url).origin;
          const state = /state=([0-9a-f]+)/.exec(page)![1]!;
          await fetch(`${local}/created?state=${state}&code=abc`, { redirect: 'manual' });
          await fetch(`${local}/installed?state=${state}`);
        },
      },
    );
    expect(page).toContain('https://github.com/organizations/acme/settings/apps/new');
  });

  it('refuses a code that came back with another state, and keeps waiting', async () => {
    let refused = 0;
    await registerApp(REQUEST, {
      ...handoff,
      fetch: converted,
      open: person(async (local, state) => {
        refused = (await fetch(`${local}/created?state=forged&code=abc`)).status;
        await fetch(`${local}/created?state=${state}&code=abc`, { redirect: 'manual' });
        await fetch(`${local}/installed?state=${state}`);
      }),
    });
    expect(refused).toBe(400);
  });

  it('fails with what GitHub said when the conversion is refused', async () => {
    const refusing = (async () => new Response('code expired', { status: 404 })) as unknown as typeof fetch;
    await expect(
      registerApp(REQUEST, {
        ...handoff,
        fetch: refusing,
        open: person(async (local, state) => {
          await fetch(`${local}/created?state=${state}&code=abc`, { redirect: 'manual' });
        }),
      }),
    ).rejects.toThrow('code expired');
  });
});
