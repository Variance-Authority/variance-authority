// compass: variance-authority.review
import { posix, relative, dirname, sep } from 'node:path';
import type { Cloudflare } from './cloudflare.js';
import {
  deploymentConfig,
  readDeployment,
  withAccountId,
  withDatabaseId,
  withVariable,
  type Deployment,
} from './config.js';
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
 * What the config already declares is the deployer's. `INGEST_CREDENTIALS` and
 * `REVIEW_CREDENTIALS` are written only when absent, and a mechanism not declared
 * is not provisioned: a deployment on `access` gets no App, and `token` is the one
 * path that mints and shares an ingest token.
 *
 * The run asks before it makes anything, so running it again is how you check a
 * deployment is still provisioned, and how a second repository is given the right
 * to push. It stops only where a person has to agree to something.
 */

export const INGEST_SECRET = 'INGEST_TOKEN';
/** Cloudflare's code for a Worker the account does not have. */
const WORKER_NOT_FOUND = 10007;
/** R2's code for a bucket the account does not have. */
const BUCKET_NOT_FOUND = 10006;
/** R2's code for an account with no R2 subscription. */
const R2_NOT_ENTITLED = 10042;

/** The App's own secret, and the key sessions are signed with. */
export const CLIENT_SECRET = 'GITHUB_CLIENT_SECRET';
export const SESSION_SECRET = 'GITHUB_SESSION_SECRET';
/** The repository secret the `variance` workflow reads. */
export const REPOSITORY_INGEST_SECRET = 'VARIANCE_INGEST_TOKEN';
/**
 * The repository variable that says an ingest rotation has begun and not
 * finished. Two writes in two services cannot be one transaction, so the run
 * journals: this goes in first, then the Worker copy, then the repository's,
 * and this comes out last. A failure between them leaves it, CI may hold a
 * token the Worker refuses, and the next run replaces both. Copies changed
 * outside the command leave no journal; `--rotate` makes a pair again.
 */
export const ROTATION_JOURNAL = 'VARIANCE_INGEST_ROTATION';

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
  /** Makes and installs the App, with the person at the browser. */
  register(request: AppRequest): Promise<RegisteredApp>;
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
  /** Leave publishing to a deployment with its own build, such as the console. */
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
    const installed = relative(dirname(request.config), io.installed).split(sep).join(posix.sep);
    await io.write(request.config, deploymentConfig(name, project, installed));
    made.push(request.config);
  }
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
  let ingest: readonly string[];
  try {
    await database(deployment, must, io, request.config, made);
    await bucket(deployment, wrangler, must, io, made);
    io.say('applying migrations');
    await must(['d1', 'migrations', 'apply', deployment.database.name, '--remote']);
    host =
      deployment.host ??
      `${deployment.name}.${await io.cloudflare(await token(), deployment.accountId).workersSubdomain()}.workers.dev`;
    const declared = await declare(deployment, host, io, request, made);
    ingest = declared.ingest;
    const worker = await workerSecrets(wrangler);
    if (declared.review.includes('github')) await signIn(deployment, host, worker, must, io, request, made);
    if (ingest.includes('token')) await ingestToken(worker, wrangler, io, request, made);
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
  if (ingest.includes('github-actions') && made.length > 0) {
    io.say(`To push from ${request.repository}, give the job \`id-token: write\` under \`permissions\` and this in variance.config:`);
    io.say(`  "baselines": { "kind": "remote", "endpoint": "${site}", "token": { "github-actions": { "audience": "https://${host}" } } }`);
  }
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

/**
 * Who the deployment recognizes, written into `vars`. A list the deployer wrote is
 * kept, and a run for another repository adds it to the ones that may push.
 */
async function declare(deployment: Placed, host: string, io: Provisioning, request: ProvisionRequest, made: string[]) {
  const held = deployment.variables;
  const list = (value: string) => value.split(',').map((each) => each.trim()).filter((each) => each !== '');
  const ingest = list(held['INGEST_CREDENTIALS'] ?? 'github-actions');
  const review = list(held['REVIEW_CREDENTIALS'] ?? 'github');

  const wanted: Record<string, string> = {
    INGEST_CREDENTIALS: ingest.join(','),
    REVIEW_CREDENTIALS: review.join(','),
  };
  if (ingest.includes('github-actions')) {
    const pushing = list(held['GITHUB_ACTIONS_REPOSITORIES'] ?? '');
    const named = pushing.some((each) => each.toLowerCase() === request.repository.toLowerCase());
    wanted['GITHUB_ACTIONS_REPOSITORIES'] = (named ? pushing : [...pushing, request.repository]).join(',');
    wanted['GITHUB_ACTIONS_AUDIENCE'] = held['GITHUB_ACTIONS_AUDIENCE'] ?? `https://${host}`;
  }
  if (review.includes('github')) wanted['GITHUB_REPOSITORY'] = held['GITHUB_REPOSITORY'] ?? request.repository;

  let text = await io.read(request.config);
  const written = Object.entries(wanted).filter(([name, value]) => held[name] !== value);
  for (const [name, value] of written) text = withVariable(text, name, value);
  if (written.length > 0) {
    await io.write(request.config, text);
    made.push(written.map(([name]) => name).join(', '));
  }
  return { ingest, review };
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
 * The App and the session key. The client id goes into the config last, so a run
 * that stops at the browser leaves nothing that reads as finished: the next run
 * starts the App again rather than deploying a sign-in that goes nowhere.
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
  const app = await io.register({
    name: deployment.name,
    host,
    ...(type === 'Organization' ? { organization: login! } : {}),
  });
  await must(['secret', 'put', CLIENT_SECRET], { input: app.clientSecret });
  await io.write(request.config, withVariable(await io.read(request.config), 'GITHUB_CLIENT_ID', app.clientId));
  made.push(`GitHub App ${app.slug}`);
}

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

  const variables = await io.run('gh', ['variable', 'list', '-R', request.repository, '--json', 'name']);
  if (variables.code !== 0) throw new Error(`gh variable list failed:\n${variables.stderr}`);
  const unfinished = (JSON.parse(variables.stdout) as { name: string }[]).some((each) => each.name === ROTATION_JOURNAL);

  // Nothing can read a secret back, so the copies are taken to match only when
  // both exist and no rotation is journaled as unfinished.
  if (unfinished) {
    io.say(`A rotation of ${INGEST_SECRET} stopped between the Worker and ${request.repository}; replacing both.`);
  }
  if (unfinished || request.rotate || !worker.has(INGEST_SECRET) || !repository.has(REPOSITORY_INGEST_SECRET)) {
    const token = io.mint();
    const begun = await io.run('gh', ['variable', 'set', ROTATION_JOURNAL, '-R', request.repository], {
      input: 'begun',
    });
    if (begun.code !== 0) {
      throw new Error(`gh variable set ${ROTATION_JOURNAL} failed, and no token was changed:\n${begun.stderr}`);
    }
    const recovery =
      `The deployment needs recovery: CI may hold a token the Worker refuses. ${ROTATION_JOURNAL} in ` +
      `${request.repository} records it, so run this again to replace both copies.`;
    const put = await wrangler(['secret', 'put', INGEST_SECRET], { input: token });
    if (put.code !== 0) {
      throw new Error(`wrangler secret put ${INGEST_SECRET} failed:\n${put.stderr || put.stdout}\n${recovery}`);
    }
    const set = await io.run('gh', ['secret', 'set', REPOSITORY_INGEST_SECRET, '-R', request.repository], {
      input: token,
    });
    if (set.code !== 0) throw new Error(`gh secret set ${REPOSITORY_INGEST_SECRET} failed:\n${set.stderr}\n${recovery}`);
    const done = await io.run('gh', ['variable', 'delete', ROTATION_JOURNAL, '-R', request.repository]);
    if (done.code !== 0) {
      throw new Error(
        `gh variable delete ${ROTATION_JOURNAL} failed:\n${done.stderr}\nBoth copies match; the next run replaces them again.`,
      );
    }
    made.push(`${INGEST_SECRET} (Worker and ${request.repository})`);
  }
}
