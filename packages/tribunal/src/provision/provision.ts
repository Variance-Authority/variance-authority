// compass: variance-authority.review
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import type { Cloudflare } from './cloudflare.js';
import {
  deploymentConfig,
  readDeployment,
  withAccountId,
  withDatabaseId,
  withVariable,
  type Deployment,
} from './config.js';
import { CLIENT_SECRET, INGEST_SECRET, SESSION_SECRET, declaration } from '../policy.js';
import type { AppRequest, RegisteredApp } from './github-app.js';

/**
 * Everything a Cloudflare tribunal needs from its account and its repository,
 * in one idempotent run, ending in a deployment that serves.
 *
 * Every value somebody would otherwise look up and paste is made or read here
 * and handed straight to the one place that needs it. The happy path is the one
 * GitHub users want: reviewers sign in with GitHub, those who can write to the
 * repository decide, and the repository's workflows push with the token the runner
 * issues them, so no secret is stored for CI at all.
 *
 * What the config already declares is the deployer's. A variable is written only
 * when absent, and a mechanism not declared is not provisioned: a deployment on
 * `access` gets no App, and `token` is the one path that mints and shares an ingest
 * token. Who may push is widened by the deployer in the file, never by a run.
 *
 * The run asks before it makes anything, so running it again is how you check a
 * deployment is still provisioned, and how to read again what CI needs. It stops
 * only where a person has to agree to something.
 */

/** Cloudflare's code for a Worker the account does not have. */
const WORKER_NOT_FOUND = 10007;
/** R2's code for a bucket the account does not have. */
const BUCKET_NOT_FOUND = 10006;
/** R2's code for an account with no R2 subscription. */
const R2_NOT_ENTITLED = 10042;

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
  exists(path: string): Promise<boolean>;
  /** The directory this package is installed in. */
  readonly installed: string;
  /** Makes and installs the App, with the person at the browser. `created` runs between the two. */
  register(request: AppRequest, created: (app: RegisteredApp) => Promise<void>): Promise<RegisteredApp>;
  /** Whether the Worker is answering at this address, rather than a placeholder or nothing. */
  serving(url: string): Promise<boolean>;
}

export interface ProvisionRequest {
  readonly config: string;
  /** `owner/name` of the repository whose CI pushes builds. */
  readonly repository: string;
  readonly rotate: boolean;
  /** Where the deployment serves the API, when not at the root: `/api`. */
  readonly mount?: string;
  /** Leave publishing to a deployment with its own build, such as a Next.js app that mounts the routes. */
  readonly skipDeploy?: boolean;
}

class Stop extends Error {}

/** Exit status: 0 provisioned, 1 stopped on something only a person can do. */
export async function provision(io: Provisioning, request: ProvisionRequest): Promise<number> {
  const made: string[] = [];
  const asked = () => io.run('npx', ['wrangler', 'auth', 'token', '--json', '--config', request.config]);
  const token = async (): Promise<string> => {
    const result = await asked();
    if (result.code !== 0) throw new Error(`wrangler auth token failed:\n${result.stderr}`);
    return (JSON.parse(result.stdout) as { token: string }).token;
  };

  if (!(await io.exists(request.config))) {
    const project = request.repository.split('/')[1]!;
    const name = `${project.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-tribunal`;
    if (!(await reachable(resolve(dirname(request.config)), io))) {
      throw new Error(
        'install @variance-authority/tribunal in this repository first: the config points into the package, ' +
          'and a package cache is gone by the next deploy',
      );
    }
    const installed = relative(dirname(request.config), io.installed).split(sep).join(posix.sep);
    await io.write(request.config, deploymentConfig(name, project, installed));
    made.push(request.config);
  }
  refuse(readDeployment(await io.read(request.config)), request);
  if ((await asked()).code !== 0) {
    io.say('Not logged in to Cloudflare. Allow it in the browser window that opens.');
    const login = await io.run('npx', ['wrangler', 'login'], { interactive: true });
    if (login.code !== 0) throw new Error('wrangler login did not complete');
  }

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

  let host: string;
  let declared: Declared;
  try {
    await database(deployment, must, io, request.config, made);
    await bucket(deployment, wrangler, must, io, made);
    io.say('applying migrations');
    await must(['d1', 'migrations', 'apply', deployment.database.name, '--remote']);
    host =
      deployment.host ??
      `${deployment.name}.${await io.cloudflare(await token(), deployment.accountId).workersSubdomain()}.workers.dev`;
    declared = await declare(deployment, host, io, request, made);
    const worker = await workerSecrets(wrangler);
    if (declared.review.includes('github')) await signIn(deployment, host, worker, must, io, request, made);
    if (declared.ingest.includes('token')) await ingestToken(worker, wrangler, io, request, made);
  } catch (error) {
    if (error instanceof Stop) return 1;
    throw error;
  }

  const site = `https://${host}${request.mount ?? ''}`;
  if (request.skipDeploy === true) {
    if (made.length > 0) io.say('Publish with your deployment\'s own deploy step.');
  } else if (made.length > 0 || !(await io.serving(`${site}/auth/me`))) {
    await must(['deploy']);
    made.push(`Worker at ${site}`);
  }

  io.say(made.length === 0 ? 'Nothing to do — already provisioned.' : `Provisioned: ${made.join(', ')}.`);
  if (declared.ingest.includes('github-actions')) tellCi(io, request.repository, site, declared.audience);
  return 0;
}

/** Said on every run: it is the half of the setup that lives in another repository. */
function tellCi(io: Provisioning, repository: string, site: string, audience: string | undefined) {
  const block = `"endpoint": "${site}", "token": { "github-actions": { "audience": "${audience}" } }`;
  io.say(`To push from ${repository}, put this in variance.config:`);
  io.say(`  "review": { ${block} },`);
  io.say(`  "baselines": { "kind": "remote", ${block} }`);
  io.say('and this in the job, with no secret to store:');
  io.say('  permissions:');
  io.say('    contents: read');
  io.say('    id-token: write');
  io.say('  steps:');
  io.say('    - run: npx variance push');
}

/** Whether Node finds the package from this directory, as a config's relative paths will. */
async function reachable(directory: string, io: Provisioning): Promise<boolean> {
  if (await io.exists(join(directory, 'node_modules/@variance-authority/tribunal'))) return true;
  const parent = dirname(directory);
  return parent !== directory && reachable(parent, io);
}

/** A mistake in the config, found while nothing has been made from it. */
function refuse(deployment: Deployment, { repository, skipDeploy }: ProvisionRequest) {
  // The page is served from `assets`, so a Worker deployed without them answers a blank one.
  if (!deployment.assets && skipDeploy !== true) {
    throw new Error('the config has no `assets`: set its `directory` to the package\'s `dist/public`');
  }
  const held = deployment.variables;
  const { ingest, review } = declaration({ ...DEFAULTS, ...held });

  const wanted = repository.toLowerCase();
  const reviewed = held['GITHUB_REPOSITORY'];
  if (review.includes('github') && reviewed !== undefined && reviewed.toLowerCase() !== wanted) {
    throw new Error(
      `GITHUB_REPOSITORY is ${reviewed}, and this run is for ${repository}. ` +
        'One deployment reviews one repository: run this for that one, or change it in the config',
    );
  }
  const pushing = held['GITHUB_ACTIONS_REPOSITORIES'];
  if (!ingest.includes('github-actions') || pushing === undefined) return;
  const covers = list(pushing).map((each) => each.toLowerCase());
  if (!covers.includes(wanted) && !covers.includes(`${wanted.split('/')[0]}/*`)) {
    throw new Error(
      `GITHUB_ACTIONS_REPOSITORIES is ${pushing}, which does not cover ${repository}. ` +
        'Who may push is a decision: add it in the config, then run this again',
    );
  }
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
  // Asked by name: `r2 bucket list` answers only its first page and says
  // nothing of the rest.
  const info = await wrangler(['r2', 'bucket', 'info', deployment.bucket]);
  if (info.code === 0) return;
  if (info.stderr.includes(`[code: ${R2_NOT_ENTITLED}]`)) {
    // R2 is off until somebody agrees to a storage plan in the dashboard; no
    // API call can agree for them.
    io.say('R2 is not enabled on this account. Enabling it is agreeing to a storage plan,');
    io.say('made once in the dashboard, and nothing here can agree for you:');
    io.say(`  https://dash.cloudflare.com/${deployment.accountId}/r2`);
    io.say('Then run this again. Everything before this step is done.');
    throw new Stop();
  }
  if (!info.stderr.includes(`[code: ${BUCKET_NOT_FOUND}]`)) {
    throw new Error(`wrangler r2 bucket info failed:\n${info.stderr || info.stdout}`);
  }
  await must(['r2', 'bucket', 'create', deployment.bucket]);
  made.push(`R2 bucket ${deployment.bucket}`);
}

const DEFAULTS = { INGEST_CREDENTIALS: 'github-actions', REVIEW_CREDENTIALS: 'github' };

const list = (value: string) =>
  value
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '');

interface Declared {
  readonly ingest: readonly string[];
  readonly review: readonly string[];
  readonly audience?: string;
}

/** Who the deployment recognizes, written into `vars` where the deployer left a value out. */
async function declare(
  deployment: Placed,
  host: string,
  io: Provisioning,
  request: ProvisionRequest,
  made: string[],
): Promise<Declared> {
  const held = deployment.variables;
  const { ingest, review } = declaration({ ...DEFAULTS, ...held });

  const wanted: Record<string, string> = { ...DEFAULTS };
  if (ingest.includes('github-actions')) {
    wanted['GITHUB_ACTIONS_REPOSITORIES'] = request.repository;
    wanted['GITHUB_ACTIONS_AUDIENCE'] = `https://${host}`;
    if (held['GITHUB_ACTIONS_BASELINE_REF'] === undefined) {
      wanted['GITHUB_ACTIONS_BASELINE_REF'] = `refs/heads/${await defaultBranch(io, request.repository)}`;
    }
  }
  if (review.includes('github')) wanted['GITHUB_REPOSITORY'] = request.repository;

  let text = await io.read(request.config);
  const written = Object.entries(wanted).filter(([name]) => held[name] === undefined);
  for (const [name, value] of written) text = withVariable(text, name, value);
  if (written.length > 0) {
    await io.write(request.config, text);
    made.push(written.map(([name]) => name).join(', '));
  }
  const audience = held['GITHUB_ACTIONS_AUDIENCE'] ?? wanted['GITHUB_ACTIONS_AUDIENCE'];
  return { ingest, review, ...(audience === undefined ? {} : { audience }) };
}

async function defaultBranch(io: Provisioning, repository: string): Promise<string> {
  const asked = await io.run('gh', ['api', `repos/${repository}`, '--jq', '.default_branch']);
  if (asked.code !== 0) throw new Error(`gh api repos/${repository} failed:\n${asked.stderr}`);
  return asked.stdout.trim();
}

/** The secrets the Worker holds. A Worker never deployed holds none, and `secret put` makes it. */
async function workerSecrets(wrangler: Wrangler): Promise<Set<string>> {
  // Any other failure answers nothing, and a secret replaced on no answer would
  // sign everybody out, or cut off the CI that holds it.
  const listed = await wrangler(['secret', 'list', '--format', 'json']);
  if (listed.code !== 0 && !listed.stderr.includes(`[code: ${WORKER_NOT_FOUND}]`)) {
    throw new Error(`wrangler secret list failed:\n${listed.stderr}`);
  }
  return new Set(listed.code === 0 ? (JSON.parse(listed.stdout) as { name: string }[]).map((each) => each.name) : []);
}

/**
 * The App and the session key. GitHub shows the App's secret once, so it is kept the
 * moment GitHub hands it over, the client id last: a run stopped before that leaves
 * nothing that reads as finished, and one stopped after it makes no second App.
 */
async function signIn(
  deployment: Placed,
  host: string,
  worker: ReadonlySet<string>,
  must: Must,
  io: Provisioning,
  request: ProvisionRequest,
  made: string[],
) {
  if (request.rotate || !worker.has(SESSION_SECRET)) {
    await must(['secret', 'put', SESSION_SECRET], { input: io.mint() });
    made.push(SESSION_SECRET);
  }
  if (deployment.variables['GITHUB_CLIENT_ID'] !== undefined && worker.has(CLIENT_SECRET)) return;

  const owner = await io.run('gh', ['api', `repos/${request.repository}`, '--jq', '.owner.type + " " + .owner.login']);
  if (owner.code !== 0) throw new Error(`gh api repos/${request.repository} failed:\n${owner.stderr}`);
  const [type, login] = owner.stdout.trim().split(' ');
  const created = async (app: RegisteredApp) => {
    await must(['secret', 'put', CLIENT_SECRET], { input: app.clientSecret });
    await io.write(request.config, withVariable(await io.read(request.config), 'GITHUB_CLIENT_ID', app.clientId));
    made.push(`GitHub App ${app.slug}`);
    // Nothing asks GitHub for an installation later, so this is the one time it is said.
    io.say(`Install it on ${request.repository}: https://github.com/apps/${app.slug}/installations/new`);
  };
  await io.register(
    { name: deployment.name, host, ...(type === 'Organization' ? { organization: login! } : {}) },
    created,
  );
}

/** Nothing can read a secret back, so the two copies are taken to match when both exist. */
async function ingestToken(
  worker: ReadonlySet<string>,
  wrangler: Wrangler,
  io: Provisioning,
  request: ProvisionRequest,
  made: string[],
) {
  const github = await io.run('gh', ['secret', 'list', '-R', request.repository, '--json', 'name']);
  if (github.code !== 0) throw new Error(`gh secret list failed:\n${github.stderr}`);
  const repository = new Set((JSON.parse(github.stdout) as { name: string }[]).map((each) => each.name));
  if (!request.rotate && worker.has(INGEST_SECRET)) {
    if (repository.has(REPOSITORY_INGEST_SECRET)) return;
    // A new token here would hand the push to this repository and refuse the one that holds it.
    throw new Error(
      `${request.repository} holds no ${REPOSITORY_INGEST_SECRET} and the Worker holds a token. ` +
        'If this is the repository that pushes, --rotate makes a pair',
    );
  }

  const token = io.mint();
  const put = await wrangler(['secret', 'put', INGEST_SECRET], { input: token });
  if (put.code !== 0) {
    throw new Error(`wrangler secret put ${INGEST_SECRET} failed, and no copy changed:\n${put.stderr || put.stdout}`);
  }
  const set = await io.run('gh', ['secret', 'set', REPOSITORY_INGEST_SECRET, '-R', request.repository], {
    input: token,
  });
  if (set.code !== 0) {
    throw new Error(
      `gh secret set ${REPOSITORY_INGEST_SECRET} failed:\n${set.stderr}\n` +
        `The Worker holds a new token and ${request.repository} the old one, so CI is refused until --rotate makes a pair.`,
    );
  }
  made.push(`${INGEST_SECRET} (Worker and ${request.repository})`);
}
