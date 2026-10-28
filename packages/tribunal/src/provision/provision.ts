// compass: variance-authority.review
import { CloudflareError, MACHINE_PREFIXES, NOT_AUTHORIZED, type AccessApp, type Cloudflare } from './cloudflare.js';
import { readDeployment, withAccountId, withDatabaseId, withVariable, type Deployment } from './config.js';

/**
 * Everything a Cloudflare tribunal needs from its account and its repository,
 * in one idempotent run.
 *
 * Every value somebody would otherwise look up and paste is made or read here
 * and handed straight to the one place that needs it: the database id and the
 * two Access values into `wrangler.jsonc`, the ingest token into the Worker and
 * into the repository's `VARIANCE_INGEST_TOKEN` secret. The ingest token is
 * never printed. The review token is printed once, because a person holds it.
 *
 * The run asks before it makes anything, so running it again is how you check a
 * deployment is still provisioned. It does not deploy: the deployment's own
 * deploy step publishes what this wrote.
 */

/**
 * What `wrangler login` grants by default, plus Access. The default login
 * cannot read or make an Access organization, and Cloudflare answers that with
 * a bare `Authentication error`.
 */
export const LOGIN_SCOPES: readonly string[] = [
  'account:read',
  'user:read',
  'workers:write',
  'workers_kv:write',
  'workers_routes:write',
  'workers_scripts:write',
  'workers_tail:read',
  'd1:write',
  'pages:write',
  'zone:read',
  'ssl_certs:write',
  'ai:write',
  'queues:write',
  'pipelines:write',
  'secrets_store:write',
  'containers:write',
  'cloudchamber:write',
  'connectivity:admin',
  'access:write',
  'teams:write',
  'offline_access',
];

export const INGEST_SECRET = 'INGEST_TOKEN';
export const REVIEW_SECRET = 'REVIEW_TOKEN';
/** The repository secret the `variance` workflow reads. */
export const REPOSITORY_INGEST_SECRET = 'VARIANCE_INGEST_TOKEN';

export interface Command {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  /** Written to the command's stdin — how a secret travels, never argv. */
  readonly input?: string;
  /** The command talks to the person directly: a browser login, a progress bar. */
  readonly interactive?: boolean;
  /** Added to the environment the command inherits. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface Provisioning {
  run(program: string, args: readonly string[], options?: RunOptions): Promise<Command>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  say(line: string): void;
  mint(): string;
  cloudflare(token: string, account: string): Cloudflare;
}

export interface ProvisionRequest {
  readonly config: string;
  /** `owner/name` of the repository whose CI pushes builds. */
  readonly repository: string;
  /** Who may sign in to review. The Cloudflare login's own email when absent. */
  readonly reviewer?: string;
  readonly rotate: boolean;
  /** Where the deployment serves the API, when not at the root: `/api`. */
  readonly mount?: string;
}

class Stop extends Error {}

/** Exit status: 0 provisioned, 1 stopped on something only a person can do. */
export async function provision(io: Provisioning, request: ProvisionRequest): Promise<number> {
  const made: string[] = [];
  const token = async (): Promise<string> => {
    const result = await io.run('npx', ['wrangler', 'auth', 'token', '--json', '--config', request.config]);
    if (result.code !== 0) throw new Error(`wrangler auth token failed:\n${result.stderr}`);
    return (JSON.parse(result.stdout) as { token: string }).token;
  };
  const deployment = await account(readDeployment(await io.read(request.config)), token, io, request.config, made);
  // The account goes in the environment too: `r2 bucket list` ignores the
  // config's `account_id` and refuses on a login that sees several accounts.
  const wrangler = async (args: readonly string[], options?: RunOptions): Promise<Command> =>
    io.run('npx', ['wrangler', ...args, '--config', request.config], {
      ...options,
      env: { CLOUDFLARE_ACCOUNT_ID: deployment.accountId },
    });
  const must = async (args: readonly string[], options?: RunOptions): Promise<string> => {
    const result = await wrangler(args, options);
    if (result.code !== 0) throw new Error(`wrangler ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
    return result.stdout;
  };

  try {
    await database(deployment, must, io, request.config, made);
    await bucket(deployment, wrangler, must, io, made);
    io.say('applying migrations');
    await must(['d1', 'migrations', 'apply', deployment.database.name, '--remote']);
    await access(deployment, wrangler, token, io, request, made);
    await secrets(wrangler, must, io, request, made);
  } catch (error) {
    if (error instanceof Stop) return 1;
    throw error;
  }

  io.say(made.length === 0 ? 'Nothing to do — already provisioned.' : `Provisioned: ${made.join(', ')}.`);
  return 0;
}

type Placed = Deployment & { readonly accountId: string };

/** The config's account, or the login's only one, written into the config. */
async function account(
  deployment: Deployment,
  token: () => Promise<string>,
  io: Provisioning,
  path: string,
  made: string[],
): Promise<Placed> {
  if (deployment.accountId !== undefined) return { ...deployment, accountId: deployment.accountId };
  const accounts = await io.cloudflare(await token(), '').accounts();
  if (accounts.length !== 1) {
    const listed = accounts.map((each) => `  ${each.id}  ${each.name}`).join('\n');
    throw new Error(
      `the config names no \`account_id\` and this login sees ${accounts.length} accounts; ` +
        `add the deployment's to the config:\n${listed}`,
    );
  }
  const [only] = accounts;
  await io.write(path, withAccountId(await io.read(path), only!.id));
  made.push(`account_id ${only!.name}`);
  return { ...deployment, accountId: only!.id };
}

type Must = (args: readonly string[], options?: RunOptions) => Promise<string>;
type Wrangler = (args: readonly string[], options?: RunOptions) => Promise<Command>;

async function database(deployment: Deployment, must: Must, io: Provisioning, path: string, made: string[]) {
  const { name } = deployment.database;
  const find = async () =>
    (JSON.parse(await must(['d1', 'list', '--json'])) as { name: string; uuid: string }[]).find(
      (each) => each.name === name,
    );
  let found = await find();
  if (found === undefined) {
    // `--no-update-config`: wrangler's own rewrite reformats the file and
    // appends a second binding beside the one already there.
    await must(['d1', 'create', name, '--no-update-config']);
    found = await find();
    if (found === undefined) throw new Error(`created D1 database ${name} and then could not find it`);
    made.push(`D1 database ${name}`);
  }
  if (deployment.database.id !== found.uuid) {
    await io.write(path, withDatabaseId(await io.read(path), found.uuid));
    made.push('database_id');
  }
}

async function bucket(deployment: Placed, wrangler: Wrangler, must: Must, io: Provisioning, made: string[]) {
  // `r2 bucket list` has no JSON mode: a block of `key: value` lines per bucket.
  const listing = await wrangler(['r2', 'bucket', 'list']);
  if (listing.code !== 0) {
    // R2 is off until somebody agrees to a storage plan in the dashboard; no
    // API call can agree for them.
    io.say('R2 is not enabled on this account. Enabling it is agreeing to a storage plan,');
    io.say('made once in the dashboard, and nothing here can agree for you:');
    io.say(`  https://dash.cloudflare.com/${deployment.accountId}/r2`);
    io.say('Then run this again. Everything before this step is done.');
    throw new Stop();
  }
  const names = listing.stdout.split('\n').flatMap((line) => (line.startsWith('name:') ? [line.slice(5).trim()] : []));
  if (names.includes(deployment.bucket)) return;
  await must(['r2', 'bucket', 'create', deployment.bucket]);
  made.push(`R2 bucket ${deployment.bucket}`);
}

async function access(
  deployment: Placed,
  wrangler: Wrangler,
  token: () => Promise<string>,
  io: Provisioning,
  request: ProvisionRequest,
  made: string[],
) {
  const api = async (): Promise<Cloudflare> => io.cloudflare(await token(), deployment.accountId);

  let cloudflare = await api();
  let teamDomain: string | undefined;
  try {
    teamDomain = await cloudflare.teamDomain();
  } catch (error) {
    if (!(error instanceof CloudflareError && error.codes.includes(NOT_AUTHORIZED))) throw error;
    io.say('The Cloudflare login cannot manage Access. Logging in again with Access added —');
    io.say('allow it in the browser window that opens.');
    const login = await wrangler(['login', '--scopes', ...LOGIN_SCOPES], { interactive: true });
    if (login.code !== 0) throw new Error('wrangler login did not complete');
    cloudflare = await api();
    teamDomain = await cloudflare.teamDomain();
  }

  if (teamDomain === undefined) {
    teamDomain = await cloudflare.createOrganization(deployment.name, `${deployment.name}.cloudflareaccess.com`);
    made.push(`Access organization ${teamDomain}`);
  }
  if (!(await cloudflare.identityProviderTypes()).includes('onetimepin')) {
    await cloudflare.createOneTimePin();
    made.push('one-time PIN sign-in');
  }

  const host = deployment.host ?? `${deployment.name}.${await cloudflare.workersSubdomain()}.workers.dev`;
  const apps = await cloudflare.apps();
  const pages = await app(apps, host, `${deployment.name} review`, cloudflare, async () => ({
    type: 'self_hosted',
    domain: host,
    session_duration: '24h',
    policies: [
      {
        name: 'reviewers',
        decision: 'allow',
        include: [{ email: { email: request.reviewer ?? (await cloudflare.email()) } }],
      },
    ],
  }), made);
  await app(apps, undefined, `${deployment.name} machines`, cloudflare, async () => ({
    type: 'self_hosted',
    destinations: MACHINE_PREFIXES.map((prefix) => ({ type: 'public', uri: `${host}${request.mount ?? ''}${prefix}` })),
    policies: [{ name: 'bearer and share callers', decision: 'bypass', include: [{ everyone: {} }] }],
  }), made);

  let text = await io.read(request.config);
  const before = text;
  text = withVariable(text, 'ACCESS_TEAM_DOMAIN', teamDomain);
  text = withVariable(text, 'ACCESS_AUD', pages.aud);
  if (text !== before) {
    await io.write(request.config, text);
    made.push('ACCESS_TEAM_DOMAIN and ACCESS_AUD');
  }
}

async function app(
  apps: readonly AccessApp[],
  domain: string | undefined,
  name: string,
  cloudflare: Cloudflare,
  body: () => Promise<Record<string, unknown>>,
  made: string[],
): Promise<AccessApp> {
  const found = apps.find((each) => (domain === undefined ? each.name === name : each.domain === domain));
  if (found !== undefined) return found;
  const created = await cloudflare.createApp({ name, ...(await body()) });
  made.push(`Access application ${name}`);
  return created;
}

async function secrets(wrangler: Wrangler, must: Must, io: Provisioning, request: ProvisionRequest, made: string[]) {
  // A Worker that was never deployed has no secrets to list and nothing to
  // hold one. `secret put` makes it.
  const listed = await wrangler(['secret', 'list', '--format', 'json']);
  const worker = new Set(
    listed.code === 0 ? (JSON.parse(listed.stdout) as { name: string }[]).map((each) => each.name) : [],
  );
  const github = await io.run('gh', ['secret', 'list', '-R', request.repository, '--json', 'name']);
  if (github.code !== 0) throw new Error(`gh secret list failed:\n${github.stderr}`);
  const repository = new Set((JSON.parse(github.stdout) as { name: string }[]).map((each) => each.name));

  // Nothing can read a secret back, so a copy missing on either side is a new
  // token on both.
  if (request.rotate || !worker.has(INGEST_SECRET) || !repository.has(REPOSITORY_INGEST_SECRET)) {
    const token = io.mint();
    await must(['secret', 'put', INGEST_SECRET], { input: token });
    const set = await io.run('gh', ['secret', 'set', REPOSITORY_INGEST_SECRET, '-R', request.repository], {
      input: token,
    });
    if (set.code !== 0) throw new Error(`gh secret set failed:\n${set.stderr}`);
    made.push(`${INGEST_SECRET} (Worker and ${request.repository})`);
  }

  if (request.rotate || !worker.has(REVIEW_SECRET)) {
    const token = io.mint();
    await must(['secret', 'put', REVIEW_SECRET], { input: token });
    made.push(REVIEW_SECRET);
    io.say(`${REVIEW_SECRET}=${token}`);
    io.say('Printed once: it decides subjects, so a person keeps it and CI never sees it.');
  }
}
