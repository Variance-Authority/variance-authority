// compass: variance-authority.review
import { expect } from 'vitest';
import type { Cloudflare } from './cloudflare.js';
import type { AppRequest } from './github-app.js';
import { provision, type Command, type ProvisionRequest, type Provisioning } from './provision.js';

const PACKAGE = 'node_modules/@variance-authority/tribunal';

const TOKEN_MODE = '"vars": { "PROJECT": "shop", "INGEST_CREDENTIALS": "token", "REVIEW_CREDENTIALS": "access" },';

export const CONFIG = `{
  "name": "tribunal-example",
  "account_id": "acc",
  "d1_databases": [{ "binding": "DB", "database_name": "db", "database_id": "REPLACE" }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "bucket" }],
  "assets": { "directory": "dist/public" },
  "vars": { "PROJECT": "shop" },
  "routes": [{ "pattern": "tribunal.example.dev", "custom_domain": true }],
}
`;

export interface World {
  databases: { name: string; uuid: string }[];
  buckets: string[];
  workerSecrets: Map<string, string>;
  githubSecrets: Map<string, string>;
  /** The Apps a person made and installed at the browser. */
  apps: AppRequest[];
  /** Where the person leaves the browser, when they do. */
  appAbandoned: 'before making it' | 'at the install page' | null;
  /** Run from a package cache such as `npx`'s, with nothing in the repository. */
  notInstalled?: boolean;
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
  /** `wrangler secret put` refuses. */
  workerRefuses: boolean;
  accounts: { id: string; name: string }[];
  /** What `secret list` meets: a Worker, none, or a failure of its own. */
  worker: 'deployed' | 'never deployed' | 'unreachable';
}

export function world(overrides: Partial<World> = {}): World {
  return {
    databases: [],
    buckets: [],
    workerSecrets: new Map(),
    githubSecrets: new Map(),
    apps: [],
    appAbandoned: null,
    owner: 'User acme',
    deploys: 0,
    serving: false,
    authorized: true,
    logins: 0,
    migrations: 0,
    r2Enabled: true,
    r2Unreachable: false,
    githubRefuses: false,
    workerRefuses: false,
    accounts: [{ id: 'acc', name: 'Acme' }],
    worker: 'deployed',
    ...overrides,
  };
}

const ok = (stdout = ''): Command => ({ code: 0, stdout, stderr: '' });

export function harness(state: World, text: string | null = CONFIG) {
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
    exists: async (path) => files.has(path) || (path.endsWith(PACKAGE) && !state.notInstalled),
    installed: '/repo/node_modules/@variance-authority/tribunal',
    register: async (request, created) => {
      if (state.appAbandoned === 'before making it') throw new Error('the browser was closed');
      state.apps.push(request);
      const app = { clientId: 'Iv1.client', clientSecret: 'app-secret', slug: 'shop-tribunal' };
      await created(app);
      if (state.appAbandoned === 'at the install page') throw new Error('the browser was closed');
      return app;
    },
    serving: async () => state.serving,
    run: async (program, args, options) => {
      const line = [program, ...args].join(' ');
      if (program !== 'gh' && !line.includes('auth token') && args[1] !== 'login') {
        expect(options?.env).toEqual({ CLOUDFLARE_ACCOUNT_ID: 'acc' });
      }
      if (program === 'gh' && args[0] === 'api') {
        return ok(args.at(-1) === '.default_branch' ? 'trunk\n' : `${state.owner}\n`);
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

export const TOKENS = CONFIG.replace('"vars": { "PROJECT": "shop" },', TOKEN_MODE);
