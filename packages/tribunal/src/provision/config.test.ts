import { describe, expect, it } from 'vitest';
import { readDeployment, withAccountId, withDatabaseId, withVariable } from './config.js';

const CONFIG = `{
  // the deployment
  "name": "tribunal-example",
  "account_id": "acc",
  "d1_databases": [
    { "binding": "DB", "database_name": "variance-tribunal-example", "database_id": "REPLACE_WITH_ID", },
  ],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "variance-tribunal-example" }],
  "vars": { "PROJECT": "snkr-shop", "ACCESS_AUD": "" },
  "routes": [{ "pattern": "tribunal-example.variance-authority.dev", "custom_domain": true }],
}
`;

describe('readDeployment', () => {
  it('reads what provisioning needs from a commented config with trailing commas', () => {
    expect(readDeployment(CONFIG)).toEqual({
      name: 'tribunal-example',
      accountId: 'acc',
      database: { name: 'variance-tribunal-example', id: 'REPLACE_WITH_ID' },
      bucket: 'variance-tribunal-example',
      host: 'tribunal-example.variance-authority.dev',
    });
  });

  it('leaves the host absent when no custom domain is routed', () => {
    const bare = CONFIG.replace(/"routes".*\n/, '');
    expect(readDeployment(bare).host).toBeUndefined();
  });

  it('leaves the account absent when the config names none', () => {
    expect(readDeployment(CONFIG.replace('  "account_id": "acc",\n', '')).accountId).toBeUndefined();
  });

  it('refuses a config without the DB binding', () => {
    expect(() => readDeployment('{ "name": "x", "account_id": "a" }')).toThrow(/d1_databases/);
  });

  it('keeps a slash inside a string while dropping comments', () => {
    const url = CONFIG.replace('"snkr-shop"', '"https://a.b/c"');
    expect(readDeployment(url).name).toBe('tribunal-example');
  });
});

describe('withDatabaseId', () => {
  it('writes the id and nothing else', () => {
    const written = withDatabaseId(CONFIG, 'ac11');
    expect(written).toBe(CONFIG.replace('REPLACE_WITH_ID', 'ac11'));
  });
});

describe('withAccountId', () => {
  it('adds the account after the name', () => {
    const none = CONFIG.replace('  "account_id": "acc",\n', '');
    expect(withAccountId(none, 'acc')).toBe(CONFIG);
  });

  it('fills an empty `account_id` in place rather than adding a second', () => {
    const text = withAccountId(CONFIG.replace('"account_id": "acc"', '"account_id": ""'), 'resolved');
    expect(readDeployment(text).accountId).toBe('resolved');
    expect(text.match(/"account_id"/g)).toHaveLength(1);
  });
});

describe('withVariable', () => {
  it('replaces an existing variable in place', () => {
    expect(withVariable(CONFIG, 'ACCESS_AUD', 'aud1')).toBe(
      CONFIG.replace('"ACCESS_AUD": ""', '"ACCESS_AUD": "aud1"'),
    );
  });

  it('adds a missing variable at the start of vars', () => {
    const written = withVariable(CONFIG, 'ACCESS_TEAM_DOMAIN', 'team.cloudflareaccess.com');
    expect(readVars(written)).toEqual({
      ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      PROJECT: 'snkr-shop',
      ACCESS_AUD: '',
    });
  });

  it('adds vars when the config has none', () => {
    const none = CONFIG.replace(/ {2}"vars".*\n/, '');
    expect(readVars(withVariable(none, 'ACCESS_AUD', 'aud1'))).toEqual({ ACCESS_AUD: 'aud1' });
  });
});

function readVars(text: string): unknown {
  return JSON.parse(
    text.replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'),
  ).vars;
}
