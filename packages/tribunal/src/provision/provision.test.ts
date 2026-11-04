import { describe, expect, it } from 'vitest';
import type { Cloudflare } from './cloudflare.js';
import type { AppRequest } from './github-app.js';
import { provision, type Command, type ProvisionRequest, type Provisioning } from './provision.js';

const TOKEN_MODE = '"vars": { "PROJECT": "shop", "INGEST_CREDENTIALS": "token", "REVIEW_CREDENTIALS": "access" },';

const CONFIG = `{
  "name": "tribunal-example",
  "account_id": "acc",
  "d1_databases": [{ "binding": "DB", "database_name": "db", "database_id": "REPLACE" }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "bucket" }],
  "vars": { "PROJECT": "shop" },
  "routes": [{ "pattern": "tribunal.example.dev", "custom_domain": true }],
}
`;

interface World {
  databases: { name: string; uuid: string }[];
  buckets: string[];
  workerSecrets: Map<string, string>;
  githubSecrets: Map<string, string>;
  githubVariables: Map<string, string>;
  /** The Apps a person made and installed at the browser. */
  apps: AppRequest[];
  /** The person leaves the browser without finishing. */
  appAbandoned: boolean;
  owner: string;
  deploys: number;
  serving: boolean;
  authorized: boolean;
  logins: number;
  migrations: number;
  r2Enabled: boolean;
  /** `r2 bucket info` fails on its own, not on the bucket. */
  r2Unreachable: boolean;
  /** `gh secret set` refuses. */
  githubRefuses: boolean;
  /** `gh variable set` refuses. */
  variablesRefused: boolean;
  /** `wrangler secret put` refuses. */
  workerRefuses: boolean;
  accounts: { id: string; name: string }[];
  /** What `secret list` meets: a Worker, none, or a failure of its own. */
  worker: 'deployed' | 'never deployed' | 'unreachable';
}

function world(overrides: Partial<World> = {}): World {
  return {
    databases: [],
    buckets: [],
    workerSecrets: new Map(),
    githubSecrets: new Map(),
    githubVariables: new Map(),
    apps: [],
    appAbandoned: false,
    owner: 'User acme',
    deploys: 0,
    serving: false,
    authorized: true,
    logins: 0,
    migrations: 0,
    r2Enabled: true,
    r2Unreachable: false,
    githubRefuses: false,
    variablesRefused: false,
    workerRefuses: false,
    accounts: [{ id: 'acc', name: 'Acme' }],
    worker: 'deployed',
    ...overrides,
  };
}

const ok = (stdout = ''): Command => ({ code: 0, stdout, stderr: '' });

function harness(state: World, text: string | null = CONFIG) {
  const files = new Map(text === null ? [] : [['wrangler.jsonc', text]]);
  const said: string[] = [];
  let minted = 0;

  const api: Cloudflare = {
    accounts: async () => state.accounts,
    workersSubdomain: async () => 'acme',
  };

  const io: Provisioning = {
    read: async (path) => files.get(path)!,
    write: async (path, content) => void files.set(path, content),
    say: (line) => void said.push(line),
    mint: () => `token${++minted}`,
    cloudflare: () => api,
    exists: async (path) => files.has(path),
    installed: '/repo/node_modules/@variance-authority/tribunal',
    register: async (request) => {
      if (state.appAbandoned) throw new Error('the browser was closed');
      state.apps.push(request);
      return { clientId: 'Iv1.client', clientSecret: 'app-secret', slug: 'shop-tribunal' };
    },
    serving: async () => state.serving,
    run: async (program, args, options) => {
      const line = [program, ...args].join(' ');
      if (program !== 'gh' && !line.includes('auth token') && args[1] !== 'login') {
        expect(options?.env).toEqual({ CLOUDFLARE_ACCOUNT_ID: 'acc' });
      }
      if (program === 'gh' && args[0] === 'api') return ok(`${state.owner}\n`);
      if (program === 'gh' && args[0] === 'variable') {
        const variables = state.githubVariables;
        if (args[1] === 'list') return ok(JSON.stringify([...variables.keys()].map((name) => ({ name }))));
        if (args[1] === 'delete') return ok(void variables.delete(args[2]!));
        if (state.variablesRefused) return { code: 1, stdout: '', stderr: 'HTTP 403' };
        variables.set(args[2]!, options?.input ?? '');
        return ok();
      }
      if (program === 'gh') {
        if (args[1] === 'list') return ok(JSON.stringify([...state.githubSecrets.keys()].map((name) => ({ name }))));
        if (args[1] === 'delete') {
          state.githubSecrets.delete(args[2]!);
          return ok();
        }
        if (state.githubRefuses) return { code: 1, stdout: '', stderr: 'HTTP 403' };
        state.githubSecrets.set(args[2]!, options?.input ?? '');
        return ok();
      }
      const [verb, noun] = args.slice(1);
      if (line.includes('auth token')) {
        return state.authorized ? ok(JSON.stringify({ type: 'oauth', token: 'cf' })) : { code: 1, stdout: '', stderr: 'Not logged in' };
      }
      if (verb === 'deploy') {
        state.deploys += 1;
        state.serving = true;
        return ok();
      }
      if (verb === 'login') {
        state.logins += 1;
        state.authorized = true;
        return ok();
      }
      if (verb === 'd1' && noun === 'list') return ok(JSON.stringify(state.databases));
      if (verb === 'd1' && noun === 'create') {
        state.databases.push({ name: args[3]!, uuid: 'uuid-1' });
        return ok();
      }
      if (verb === 'd1' && noun === 'migrations') {
        state.migrations += 1;
        return ok();
      }
      if (verb === 'r2' && args[3] === 'info') {
        if (state.r2Unreachable) return { code: 1, stdout: '', stderr: 'Not logged in.' };
        if (!state.r2Enabled) return { code: 1, stdout: '', stderr: 'Account not entitled to this feature. [code: 10042]' };
        if (!state.buckets.includes(args[4]!)) {
          return { code: 1, stdout: '', stderr: 'The specified bucket does not exist. [code: 10006]' };
        }
        return ok(`name:           ${args[4]}\n`);
      }
      if (verb === 'r2' && args[3] === 'create') {
        state.buckets.push(args[4]!);
        return ok();
      }
      if (verb === 'secret' && noun === 'list') {
        if (state.worker === 'never deployed') {
          return { code: 1, stdout: '', stderr: 'This Worker does not exist on your account. [code: 10007]' };
        }
        if (state.worker === 'unreachable') return { code: 1, stdout: '', stderr: 'fetch failed' };
        return ok(JSON.stringify([...state.workerSecrets.keys()].map((name) => ({ name, type: 'secret_text' }))));
      }
      if (verb === 'secret' && noun === 'put') {
        if (state.workerRefuses) return { code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' };
        state.workerSecrets.set(args[3]!, options?.input ?? '');
        return ok();
      }
      throw new Error(`unexpected: ${line}`);
    },
  };

  const run = (rotate = false, extra: Partial<ProvisionRequest> = {}) =>
    provision(io, { config: 'wrangler.jsonc', repository: 'acme/shop', rotate, ...extra });
  return { run, files, said };
}

const TOKENS = CONFIG.replace('"vars": { "PROJECT": "shop" },', TOKEN_MODE);

describe('provision', () => {
  it('provisions a fresh account end to end: GitHub sign-in, Actions push, deployed', async () => {
    const state = world();
    const { run, files, said } = harness(state);

    expect(await run()).toBe(0);

    expect(state.databases).toEqual([{ name: 'db', uuid: 'uuid-1' }]);
    expect(state.buckets).toEqual(['bucket']);
    expect(state.migrations).toBe(1);
    expect(state.apps).toEqual([{ name: 'tribunal-example', host: 'tribunal.example.dev' }]);
    expect(state.workerSecrets.get('GITHUB_CLIENT_SECRET')).toBe('app-secret');
    expect(state.workerSecrets.get('GITHUB_SESSION_SECRET')).toBe('token1');
    expect(state.workerSecrets.has('INGEST_TOKEN')).toBe(false);
    expect(state.githubSecrets.size).toBe(0);
    expect(state.deploys).toBe(1);

    const written = files.get('wrangler.jsonc')!;
    expect(written).toContain('"database_id": "uuid-1"');
    expect(written).toContain('"INGEST_CREDENTIALS": "github-actions"');
    expect(written).toContain('"REVIEW_CREDENTIALS": "github"');
    expect(written).toContain('"GITHUB_REPOSITORY": "acme/shop"');
    expect(written).toContain('"GITHUB_ACTIONS_REPOSITORIES": "acme/shop"');
    expect(written).toContain('"GITHUB_ACTIONS_AUDIENCE": "https://tribunal.example.dev"');
    expect(written).toContain('"GITHUB_CLIENT_ID": "Iv1.client"');

    const printed = said.join('\n');
    expect(printed).not.toContain('app-secret');
    expect(printed).not.toContain('token1');
    expect(printed).toContain('id-token: write');
    expect(printed).toContain('"audience": "https://tribunal.example.dev"');
  });

  it('writes a config for the packaged Worker when the deployment has none', async () => {
    const state = world();
    const { run, files } = harness(state, null);

    expect(await run(false, { config: '/repo/deploy/wrangler.jsonc' })).toBe(0);

    const written = files.get('/repo/deploy/wrangler.jsonc')!;
    expect(written).toContain('"name": "shop-tribunal"');
    expect(written).toContain('"main": "../node_modules/@variance-authority/tribunal/dist/worker-entry.js"');
    expect(written).toContain('"directory": "../node_modules/@variance-authority/tribunal/dist/public"');
    expect(state.deploys).toBe(1);
  });

  it('registers the App under the organization that owns the repository', async () => {
    const state = world({ owner: 'Organization acme' });
    await harness(state).run();
    expect(state.apps[0]!.organization).toBe('acme');
  });

  it('serves the workers.dev host when no custom domain is routed', async () => {
    const state = world();
    await harness(state, CONFIG.replace(/ {2}"routes".*\n/, '')).run();
    expect(state.apps[0]!.host).toBe('tribunal-example.acme.workers.dev');
  });

  it('leaves nothing that reads as finished when the person stops at the browser', async () => {
    const state = world({ appAbandoned: true });
    const { run, files } = harness(state);

    await expect(run()).rejects.toThrow('the browser was closed');
    expect(files.get('wrangler.jsonc')).not.toContain('GITHUB_CLIENT_ID');
    expect(state.deploys).toBe(0);

    state.appAbandoned = false;
    expect(await run()).toBe(0);
    expect(state.apps).toHaveLength(1);
    expect(state.deploys).toBe(1);
  });

  it('changes nothing on a second run', async () => {
    const state = world();
    const { run, files, said } = harness(state);
    await run();
    const before = { config: files.get('wrangler.jsonc'), secrets: new Map(state.workerSecrets) };
    said.length = 0;

    expect(await run()).toBe(0);

    expect(files.get('wrangler.jsonc')).toBe(before.config);
    expect(state.workerSecrets).toEqual(before.secrets);
    expect(state.apps).toHaveLength(1);
    expect(state.deploys).toBe(1);
    expect(state.migrations).toBe(2);
    expect(said).toEqual(['applying migrations', 'Nothing to do — already provisioned.']);
  });

  it('deploys again when nothing changed but the Worker is not serving', async () => {
    const state = world();
    const { run } = harness(state);
    await run();
    state.serving = false;

    await run();

    expect(state.deploys).toBe(2);
  });

  it('adds a second repository to the ones that may push, and keeps the first', async () => {
    const state = world();
    const { run, files } = harness(state);
    await run();

    await run(false, { repository: 'acme/other' });

    expect(files.get('wrangler.jsonc')).toContain('"GITHUB_ACTIONS_REPOSITORIES": "acme/shop,acme/other"');
    expect(files.get('wrangler.jsonc')).toContain('"GITHUB_REPOSITORY": "acme/shop"');
    expect(state.apps).toHaveLength(1);
  });

  it('makes no App for a deployment that declares another mechanism', async () => {
    const state = world();
    const { run, files } = harness(state, TOKENS);

    expect(await run()).toBe(0);

    expect(state.apps).toEqual([]);
    expect(files.get('wrangler.jsonc')).not.toContain('GITHUB_');
    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('token1');
    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('token1');
  });

  it('leaves publishing to a deployment with its own build', async () => {
    const state = world();
    const { run, said } = harness(state);

    expect(await run(false, { skipDeploy: true })).toBe(0);

    expect(state.deploys).toBe(0);
    expect(said.join('\n')).toContain("your deployment's own deploy step");
  });

  it('asks the mount for whether the Worker serves, and tells CI the same address', async () => {
    const { run, said } = harness(world());
    await run(false, { mount: '/api' });
    expect(said.join('\n')).toContain('"endpoint": "https://tribunal.example.dev/api"');
  });

  it('replaces the session key on --rotate, and signs nobody in with the old one', async () => {
    const state = world();
    const { run } = harness(state);
    await run();

    await run(true);

    expect(state.workerSecrets.get('GITHUB_SESSION_SECRET')).toBe('token2');
    expect(state.deploys).toBe(2);
  });

  it('mints an ingest token into a Worker that was never deployed', async () => {
    const state = world({ worker: 'never deployed' });
    const { run } = harness(state, TOKENS);

    expect(await run()).toBe(0);

    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('token1');
  });

  it('replaces no token when the Worker cannot be asked what it holds', async () => {
    const state = world({ worker: 'unreachable' });
    state.workerSecrets.set('INGEST_TOKEN', 'old');
    state.githubSecrets.set('VARIANCE_INGEST_TOKEN', 'old');
    const { run } = harness(state, TOKENS);

    await expect(run()).rejects.toThrow('fetch failed');

    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('old');
    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('old');
  });

  it('mints a new ingest token when the repository lost its copy', async () => {
    const state = world();
    const { run } = harness(state, TOKENS);
    await run();
    state.githubSecrets.clear();

    await run();

    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('token2');
    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('token2');
  });

  it('logs in when wrangler has no login, once', async () => {
    const state = world({ authorized: false });
    expect(await harness(state).run()).toBe(0);
    expect(state.logins).toBe(1);
  });

  it("takes the login's only account when the config names none, and writes it", async () => {
    const state = world();
    const { run, files } = harness(state, CONFIG.replace('  "account_id": "acc",\n', ''));
    expect(await run()).toBe(0);
    expect(files.get('wrangler.jsonc')).toContain('"account_id": "acc"');
  });

  it('refuses to pick between several accounts', async () => {
    const state = world({ accounts: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    const { run } = harness(state, CONFIG.replace('  "account_id": "acc",\n', ''));
    await expect(run()).rejects.toThrow(/sees 2 accounts/);
    expect(state.databases).toEqual([]);
  });

  it('stops with the dashboard address when R2 is not enabled', async () => {
    const state = world({ r2Enabled: false });
    const { run, said } = harness(state);
    expect(await run()).toBe(1);
    expect(said.join('\n')).toContain('https://dash.cloudflare.com/acc/r2');
    expect(state.workerSecrets.size).toBe(0);
  });

  it('finds the bucket by name, however many buckets the account has', async () => {
    const state = world({ buckets: [...Array.from({ length: 25 }, (_, index) => `other${index}`), 'bucket'] });
    expect(await harness(state).run()).toBe(0);
    expect(state.buckets.filter((name) => name === 'bucket')).toHaveLength(1);
  });

  it('reports an R2 failure that is not billing as itself', async () => {
    const state = world({ r2Unreachable: true });
    const { run, said } = harness(state);
    await expect(run()).rejects.toThrow('Not logged in.');
    expect(said.join('\n')).not.toContain('dash.cloudflare.com');
  });

  it('keeps the repository copy CI pushes with when the Worker refuses the new one', async () => {
    const state = world();
    state.workerSecrets.set('INGEST_TOKEN', 'old');
    state.githubSecrets.set('VARIANCE_INGEST_TOKEN', 'old');
    state.workerRefuses = true;

    await expect(harness(state, TOKENS).run(true)).rejects.toThrow(/secret put INGEST_TOKEN failed/);

    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('old');
  });

  it('replaces both copies on the next run after a rotation stopped between them', async () => {
    const state = world();
    const { run, said } = harness(state, TOKENS);
    await run();
    state.githubRefuses = true;

    await expect(run(true)).rejects.toThrow(/run this again/);
    expect(state.workerSecrets.get('INGEST_TOKEN')).not.toBe(state.githubSecrets.get('VARIANCE_INGEST_TOKEN'));
    state.githubRefuses = false;
    said.length = 0;

    expect(await run()).toBe(0);

    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe(state.workerSecrets.get('INGEST_TOKEN'));
    expect(state.githubVariables.size).toBe(0);
    expect(said.join('\n')).toMatch(/stopped between/);
    expect(said.at(-1)).not.toMatch(/already provisioned/);
  });

  it('touches no token when it cannot record that a rotation has begun', async () => {
    const state = world();
    state.workerSecrets.set('INGEST_TOKEN', 'old');
    state.githubSecrets.set('VARIANCE_INGEST_TOKEN', 'old');
    state.variablesRefused = true;

    await expect(harness(state, TOKENS).run(true)).rejects.toThrow(/gh variable set/);

    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('old');
    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('old');
  });
});
