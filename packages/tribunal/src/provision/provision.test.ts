import { describe, expect, it } from 'vitest';
import { CONFIG, harness, TOKENS, world } from './provision.fixture.js';

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
    expect(written).toContain('"GITHUB_ACTIONS_BASELINE_REF": "refs/heads/trunk"');
    expect(written).toContain('"GITHUB_CLIENT_ID": "Iv1.client"');

    const printed = said.join('\n');
    expect(printed).not.toContain('app-secret');
    expect(printed).not.toContain('token1');
    expect(printed).toContain('id-token: write');
    expect(printed).toContain('contents: read');
    expect(printed).toContain('"audience": "https://tribunal.example.dev"');
    expect(printed).toContain('"review": { "endpoint": "https://tribunal.example.dev"');
    expect(printed).toContain('"baselines": { "kind": "remote"');
    expect(printed).toContain('variance push');
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
    const state = world({ appAbandoned: 'before making it' });
    const { run, files } = harness(state);

    await expect(run()).rejects.toThrow('the browser was closed');
    expect(files.get('wrangler.jsonc')).not.toContain('GITHUB_CLIENT_ID');
    expect(state.deploys).toBe(0);

    state.appAbandoned = null;
    expect(await run()).toBe(0);
    expect(state.apps).toHaveLength(1);
    expect(state.deploys).toBe(1);
  });

  it('keeps an App GitHub already made when the person stops at the install page', async () => {
    const state = world({ appAbandoned: 'at the install page' });
    const { run, files, said } = harness(state);

    await expect(run()).rejects.toThrow('the browser was closed');

    expect(state.workerSecrets.get('GITHUB_CLIENT_SECRET')).toBe('app-secret');
    expect(files.get('wrangler.jsonc')).toContain('"GITHUB_CLIENT_ID": "Iv1.client"');
    expect(said.join('\n')).toContain('https://github.com/apps/shop-tribunal/installations/new');

    state.appAbandoned = null;
    expect(await run()).toBe(0);
    expect(state.apps).toHaveLength(1);
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
    expect(said.slice(0, 2)).toEqual(['applying migrations', 'Nothing to do — already provisioned.']);
    expect(said.join('\n')).toContain('"baselines": { "kind": "remote"');
  });

  it('deploys again when nothing changed but the Worker is not serving', async () => {
    const state = world();
    const { run } = harness(state);
    await run();
    state.serving = false;

    await run();

    expect(state.deploys).toBe(2);
  });

  it('refuses a repository the deployment does not cover, and widens nothing', async () => {
    const state = world();
    const { run, files } = harness(state);
    await run();
    const before = files.get('wrangler.jsonc');

    await expect(run(false, { repository: 'acme/other' })).rejects.toThrow(/acme\/other/);

    expect(files.get('wrangler.jsonc')).toBe(before);
  });

  it('says who may push when that is what stops the run', async () => {
    const pinned = CONFIG.replace('"vars": { "PROJECT": "shop" },', '"vars": { "GITHUB_ACTIONS_REPOSITORIES": "acme/one, acme/two" },');
    await expect(harness(world(), pinned).run()).rejects.toThrow(/GITHUB_ACTIONS_REPOSITORIES.*acme\/shop/);
  });

  it('takes a repository an owner-wide entry covers', async () => {
    const state = world();
    const covered = CONFIG.replace(
      '"vars": { "PROJECT": "shop" },',
      '"vars": { "GITHUB_ACTIONS_REPOSITORIES": "acme/*", "GITHUB_REPOSITORY": "Acme/Shop" },',
    );
    expect(await harness(state, covered).run()).toBe(0);
  });

  it.each([
    ['a mechanism misspelled', '"REVIEW_CREDENTIALS": "gihub"', /gihub/],
    ['a list that names nothing', '"INGEST_CREDENTIALS": " , "', /names no mechanism/],
    ['a stale value', '"REVIEW_CREDENTIALS": "github", "ACCESS_TEAM_DOMAIN": "x.example"', /ACCESS_TEAM_DOMAIN/],
    ['a reviewed repository the run is not for', '"GITHUB_REPOSITORY": "acme/other"', /GITHUB_REPOSITORY.*acme\/other/],
  ])('refuses %s before it makes anything', async (_, vars, reason) => {
    const state = world();
    const { run } = harness(state, CONFIG.replace('"vars": { "PROJECT": "shop" },', `"vars": { ${vars} },`));

    await expect(run()).rejects.toThrow(reason);

    expect(state.databases).toEqual([]);
    expect(state.logins).toBe(0);
  });

  it('leaves a list the deployer wrote as they wrote it', async () => {
    const spaced = CONFIG.replace(
      '"vars": { "PROJECT": "shop" },',
      '"vars": { "INGEST_CREDENTIALS": "github-actions, token", "REVIEW_CREDENTIALS": "github" },',
    );
    const { run, files } = harness(world(), spaced);

    await run();

    expect(files.get('wrangler.jsonc')).toContain('"INGEST_CREDENTIALS": "github-actions, token"');
  });

  it('keeps a baseline ref the deployer chose', async () => {
    const chosen = CONFIG.replace('"vars": { "PROJECT": "shop" },', '"vars": { "GITHUB_ACTIONS_BASELINE_REF": "refs/heads/release" },');
    const { run, files } = harness(world(), chosen);

    await run();

    expect(files.get('wrangler.jsonc')).toContain('"GITHUB_ACTIONS_BASELINE_REF": "refs/heads/release"');
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

  it('replaces no token for a repository that holds no copy, unless asked to', async () => {
    const state = world();
    const { run } = harness(state, TOKENS);
    await run();
    state.githubSecrets.clear();

    await expect(run()).rejects.toThrow(/acme\/shop holds no VARIANCE_INGEST_TOKEN.*--rotate/s);

    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('token1');
    await run(true);
    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe('token2');
    expect(state.workerSecrets.get('INGEST_TOKEN')).toBe('token2');
  });

  it('refuses a config whose Worker would serve a page with no assets', async () => {
    const bare = CONFIG.replace('  "assets": { "directory": "dist/public" },\n', '');

    await expect(harness(world(), bare).run()).rejects.toThrow(/`assets`/);
    expect(await harness(world(), bare).run(false, { skipDeploy: true })).toBe(0);
  });

  it('writes no config that points into a package cache', async () => {
    const { run, files } = harness(world({ notInstalled: true }), null);

    await expect(run()).rejects.toThrow(/install @variance-authority\/tribunal/i);

    expect(files.has('wrangler.jsonc')).toBe(false);
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

  it('says --rotate makes a pair when the repository refuses the token the Worker took', async () => {
    const state = world();
    const { run } = harness(state, TOKENS);
    await run();
    state.githubRefuses = true;

    await expect(run(true)).rejects.toThrow(/gh secret set VARIANCE_INGEST_TOKEN failed.*--rotate/s);
    state.githubRefuses = false;

    await run(true);

    expect(state.githubSecrets.get('VARIANCE_INGEST_TOKEN')).toBe(state.workerSecrets.get('INGEST_TOKEN'));
  });
});
