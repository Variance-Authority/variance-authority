// compass: variance-authority.review
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Registering the GitHub App a deployment signs people in with, from a manifest.
 *
 * GitHub has no API that makes an App or an OAuth client outright. The manifest
 * flow is the closest thing: a person confirms one page, GitHub hands a code back
 * to a local address, and the code converts to the credentials. Nobody copies a
 * client id or a secret. The installation is the second page, and it is needed
 * because a user's token reaches only what both the user and the App can reach.
 *
 * The App asks for `metadata: read` and nothing else, and it is `public` because a
 * private one can be authorized only by members of the organization that owns it,
 * which locks out a collaborator with write access. Public means anybody may
 * install it, and installing it gives them nothing: who decides is the
 * repository's write check, which runs on every sign-in.
 */

export interface AppRequest {
  /** What GitHub lists the App as. GitHub asks for another on the page when it is taken. */
  readonly name: string;
  /** The account that owns it: an organization's login, or absent for the person's own. */
  readonly organization?: string;
  /** The host the deployment serves from, which is where GitHub returns a person. */
  readonly host: string;
}

export interface RegisteredApp {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly slug: string;
}

export interface AppHandoff {
  /** Sends the person's browser to the address. */
  open(url: string): Promise<void>;
  say(line: string): void;
  readonly fetch?: typeof fetch;
}

/** GitHub's limit on an App's name. */
const NAME_LENGTH = 34;

/** What GitHub is asked to make. `local` is this run's address, which it returns to twice. */
export function manifest(request: AppRequest, local: string): Readonly<Record<string, unknown>> {
  const site = `https://${request.host}`;
  return {
    name: request.name.slice(0, NAME_LENGTH),
    url: site,
    hook_attributes: { url: site, active: false },
    redirect_url: `${local}/created`,
    setup_url: `${local}/installed`,
    callback_urls: [`${site}/auth/github/callback`],
    public: true,
    default_permissions: { metadata: 'read' },
    default_events: [],
  };
}

/** Answers once the person has made and installed the App. Waits as long as they take. */
export function registerApp(request: AppRequest, handoff: AppHandoff): Promise<RegisteredApp> {
  const send = handoff.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const state = randomBytes(16).toString('hex');
  const account = request.organization === undefined ? '' : `/organizations/${request.organization}`;

  return new Promise((resolve, reject) => {
    let registered: RegisteredApp | undefined;
    const server = createServer((incoming, outgoing) => {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
      const answer = (status: number, body: string, headers: Record<string, string> = {}) => {
        outgoing.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
        outgoing.end(body);
      };
      const finish = (settle: () => void) => {
        server.close();
        server.closeAllConnections();
        settle();
      };

      if (url.pathname === '/start') {
        const value = JSON.stringify(manifest(request, local())).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
        answer(
          200,
          `<!doctype html><form id="f" method="post" action="https://github.com${account}/settings/apps/new?state=${state}">` +
            `<input type="hidden" name="manifest" value="${value}"></form><script>f.submit()</script>`,
        );
      } else if (url.pathname === '/created') {
        if (url.searchParams.get('state') !== state) return answer(400, 'This is not the registration this run started.');
        converted(url.searchParams.get('code') ?? '', send).then(
          (app) => {
            registered = app;
            answer(302, '', { location: `https://github.com/apps/${app.slug}/installations/new` });
          },
          (error: unknown) => {
            answer(500, 'GitHub did not hand the App over. The command says why.');
            finish(() => reject(error));
          },
        );
      } else if (url.pathname === '/installed' && registered !== undefined) {
        const app = registered;
        answer(200, 'Installed. You can close this tab.');
        finish(() => resolve(app));
      } else {
        answer(404, 'Not here.');
      }
    });
    const local = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      handoff.say('Confirm the GitHub App in the browser, then install it on the repository:');
      handoff.say(`  ${local()}/start`);
      handoff.open(`${local()}/start`).catch(reject);
    });
  });
}

async function converted(code: string, send: typeof fetch): Promise<RegisteredApp> {
  const response = await send(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'variance-authority-tribunal' },
  });
  if (!response.ok) throw new Error(`GitHub's manifest conversion answered ${response.status}: ${await response.text()}`);
  const app = (await response.json()) as { client_id: string; client_secret: string; slug: string };
  return { clientId: app.client_id, clientSecret: app.client_secret, slug: app.slug };
}
