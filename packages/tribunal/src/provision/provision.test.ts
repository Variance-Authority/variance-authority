import { describe, expect, it } from 'vitest';
import { BASELINE_FIND_PATH, BASELINE_PUT_PATH, CACHE_FIND_PATH, CACHE_PUT_PATH } from '@variance-authority/remote/store';
import { CloudflareError, MACHINE_PREFIXES, NOT_AUTHORIZED, type AccessApp, type Cloudflare } from './cloudflare.js';
import { provision, type Command, type Provisioning } from './provision.js';

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
  teamDomain: string | undefined;
  providers: string[];
  apps: AccessApp[];
  authorized: boolean;
  logins: number;
  migrations: number;
  r2Enabled: boolean;
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
    teamDomain: undefined,
    providers: [],
    apps: [],
    authorized: true,
    logins: 0,
    migrations: 0,
    r2Enabled: true,
    accounts: [{ id: 'acc', name: 'Acme' }],
    worker: 'deployed',
    ...overrides,
  };
}

const ok = (stdout = ''): Command => ({ code: 0, stdout, stderr: '' });

function harness(state: World, text = CONFIG, terminal = false) {
  const files = new Map([['wrangler.jsonc', text]]);
  const said: string[] = [];
  let minted = 0;

  const api: Cloudflare = {
    accounts: async () => state.accounts,
    email: async () => 'owner@example.dev',
    workersSubdomain: async () => 'acme',
    teamDomain: async () => {
      if (!state.authorized) throw new CloudflareError([NOT_AUTHORIZED], 403, 'Authentication error');
      return state.teamDomain;
    },
    createOrganization: async (_, domain) => (state.teamDomain = domain),
    identityProviderTypes: async () => state.providers,
    createOneTimePin: async () => void state.providers.push('onetimepin'),
    apps: async () => state.apps,
    createApp: async (body) => {
      const app = { id: `id${state.apps.length}`, aud: `aud${state.apps.length}`, ...body } as unknown as AccessApp;
      state.apps.push(app);
      return app;
    },
  };

  const io: Provisioning = {
    read: async (path) => files.get(path)!,
    write: async (path, content) => void files.set(path, content),
    say: (line) => void said.push(line),
    mint: () => `token${++minted}`,
    terminal,
    cloudflare: () => api,
    run: async (program, args, options) => {
      const line = [program, ...args].join(' ');
      if (program !== 'gh' && !line.includes('auth token')) {
        expect(options?.env).toEqual({ CLOUDFLARE_ACCOUNT_ID: 'acc' });
      }
      if (program === 'gh') {
        if (args[1] === 'list') return ok(JSON.stringify([...state.githubSecrets.keys()].map((name) => ({ name }))));
        state.githubSecrets.set(args[2]!, options?.input ?? '');
        return ok();
      }
      const [verb, noun] = args.slice(1);
      if (line.includes('auth token')) return ok(JSON.stringify({ type: 'oauth', token: 'cf' }));
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
      if (verb === 'r2' && args[3] === 'list') {
        if (!state.r2Enabled) return { code: 1, stdout: '', stderr: 'code: 10042' };
        return ok(state.buckets.map((name) => `name:           ${name}\ncreation_date:  x\n`).join('\n'));
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
        state.workerSecrets.set(args[3]!, options?.input ?? '');
        return ok();
      }
      throw new Error(`unexpected: ${line}`);
    },
  };

  const run = (rotate = false, mount?: string) =>
    provision(io, { config: 'wrangler.jsonc', repository: 'acme/shop', rotate, ...(mount === undefined ? {} : { mount }) });
  return { run, files, said };
}

describe('provision', () => {
  it('provisions a fresh account end to end and never prints the ingest token', async () => {
    const state = world();
    const { run, files, said } = harness(state);

    expect(await run()).toBe(0);

    expect(state.databases).toEqual([{ name: 'db', uuid: 'uuid-1' }]);
    expect(state.buckets).toEqual(['bucket']);
    expect(state.migrations).toBe(1);
    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('token1');
    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('token1');
    expect(state.workerSecrets.get('REVIEW_TOKEN')).toBe('token2');
    expect(said.join('\n')).not.toContain('token1');

    const written = files.get('wrangler.jsonc')!;
    expect(written).toContain('"database_id": "uuid-1"');
    expect(written).toContain('"ACCESS_TEAM_DOMAIN": "tribunal-example.cloudflareaccess.com"');
    expect(written).toContain('"ACCESS_AUD": "aud0"');
    expect(state.providers).toEqual(['onetimepin']);
  });

  it('puts Access in front of the pages and bypasses the machine paths', async () => {
    const state = world();
    await harness(state).run();

    const [pages, machines] = state.apps as unknown as Record<string, unknown>[];
    expect(pages).toMatchObject({
      type: 'self_hosted',
      domain: 'tribunal.example.dev',
      policies: [{ decision: 'allow', include: [{ email: { email: 'owner@example.dev' } }] }],
    });
    expect(machines).toMatchObject({ policies: [{ decision: 'bypass', include: [{ everyone: {} }] }] });
    expect((machines!['destinations'] as { uri: string }[]).map((each) => each.uri)).toEqual([
      'tribunal.example.dev/baseline',
      'tribunal.example.dev/cache',
      'tribunal.example.dev/review',
      'tribunal.example.dev/share',
      'tribunal.example.dev/version',
      'tribunal.example.dev/v1',
    ]);
  });

  it('bypasses the machine paths under the mount the API is served at', async () => {
    const state = world();
    await harness(state).run(false, '/api');
    const machines = state.apps[1] as unknown as { destinations: { uri: string }[] };
    expect(machines.destinations[0]!.uri).toBe('tribunal.example.dev/api/baseline');
  });

  it('bypasses every path the remote client calls', () => {
    for (const path of [BASELINE_FIND_PATH, BASELINE_PUT_PATH, CACHE_FIND_PATH, CACHE_PUT_PATH]) {
      expect(MACHINE_PREFIXES.some((prefix) => path.startsWith(`${prefix}/`))).toBe(true);
    }
  });

  it('protects the workers.dev host when no custom domain is routed', async () => {
    const state = world();
    await harness(state, CONFIG.replace(/ {2}"routes".*\n/, '')).run();
    expect(state.apps[0]!.domain).toBe('tribunal-example.acme.workers.dev');
  });

  it('changes nothing on a second run', async () => {
    const state = world();
    const { run, files, said } = harness(state);
    await run();
    const before = { config: files.get('wrangler.jsonc'), secrets: new Map(state.workerSecrets), apps: state.apps.length };
    said.length = 0;

    expect(await run()).toBe(0);

    expect(files.get('wrangler.jsonc')).toBe(before.config);
    expect(state.workerSecrets).toEqual(before.secrets);
    expect(state.apps).toHaveLength(before.apps);
    expect(state.migrations).toBe(2);
    expect(said.at(-1)).toMatch(/already provisioned/);
  });

  it('keeps the review token off the output when nobody is at a terminal', async () => {
    const state = world();
    const { run, said } = harness(state);

    expect(await run()).toBe(0);

    expect(state.workerSecrets.get('REVIEW_TOKEN')).toBe('token2');
    expect(said.join('\n')).not.toContain('token2');
    expect(said.join('\n')).toContain('--rotate');
  });

  it('prints the review token once to a person at a terminal', async () => {
    const state = world();
    const { run, said } = harness(state, CONFIG, true);

    expect(await run()).toBe(0);

    expect(said.filter((line) => line.includes('token2'))).toEqual(['REVIEW_TOKEN=token2']);
  });

  it('mints both tokens into a Worker that was never deployed', async () => {
    const state = world({ worker: 'never deployed' });
    const { run } = harness(state);

    expect(await run()).toBe(0);

    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('token1');
    expect(state.workerSecrets.get('REVIEW_TOKEN')).toBe('token2');
  });

  it('replaces no token when the Worker cannot be asked what it holds', async () => {
    const state = world({ worker: 'unreachable' });
    state.workerSecrets.set('INGEST_TOKEN', 'old');
    state.githubSecrets.set('VARIANCE_INGEST_TOKEN', 'old');
    const { run } = harness(state);

    await expect(run()).rejects.toThrow('fetch failed');

    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('old');
    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('old');
  });

  it('mints a new ingest token when the repository lost its copy', async () => {
    const state = world();
    const { run } = harness(state);
    await run();
    state.githubSecrets.clear();

    await run();

    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('token3');
    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('token3');
    expect(state.workerSecrets.get('REVIEW_TOKEN')).toBe('token2');
  });

  it('logs in again with the Access scopes when the login lacks them, once', async () => {
    const state = world({ authorized: false });
    expect(await harness(state).run()).toBe(0);
    expect(state.logins).toBe(1);
    expect(state.teamDomain).toBe('tribunal-example.cloudflareaccess.com');
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
});
