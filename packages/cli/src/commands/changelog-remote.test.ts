import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';
import { formatRemoteChangelog, readRemoteChangelog, type RemoteChangelog } from './changelog-remote.js';

/**
 * A remote store's history is read where it was recorded: the deployment's
 * changelog, asked with the share token — which reads what review settled and
 * never decides — rather than refused for not being a `git log`.
 */

const DEPLOYMENT = 'https://tribunal.example';

const SHARE: Config['share'] = { kind: 'http', endpoint: `${DEPLOYMENT}/share`, token: () => 'share-secret' };

/** A remote store at the deployment, with `share` stored there, or with no share when it is `null`. */
function config(share: Config['share'] | null = SHARE): Config {
  return {
    project: 'design-system',
    retention: 'durable',
    baselines: { kind: 'remote', endpoint: `${DEPLOYMENT}/` },
    ...(share === null ? {} : { share }),
  } as Config;
}

const CHANGELOG: RemoteChangelog = {
  changes: [
    {
      fingerprint: 'v1:aaaaaaaaaaaaaaaa',
      component: 'Card',
      file: 'src/Card.tsx',
      subjects: ['story:card', 'story:card--dark'],
      builds: ['ci-2', 'ci-1'],
      by: ['marina', 'anton'],
      at: '2026-06-02T10:00:00.000Z',
      intent: 'tighten the card',
      note: 'the border was the point',
    },
  ],
  ungrouped: [
    {
      build: 'ci-1',
      subject: 'route:/pricing',
      commit: 'abc123def4567890',
      by: 'anton',
      at: '2026-06-01T10:00:00.000Z',
      regions: [],
    },
  ],
};

function answering(status: number, body: unknown) {
  const asked: { url: string; authorization: string | null }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { asked, fetch };
}

describe('the changelog of a remote store', () => {
  it('is read from the deployment with the share token, narrowed there', async () => {
    const { asked, fetch } = answering(200, CHANGELOG);
    const read = await readRemoteChangelog({
      config: config(),
      deployment: DEPLOYMENT,
      subject: 'story:card',
      component: 'Card',
      limit: 5,
      since: '2026-06-01T00:00:00.000Z',
      fetch,
    });
    expect(read).toEqual(CHANGELOG);
    expect(asked).toEqual([
      {
        url: `${DEPLOYMENT}/review/changelog?component=Card&subject=story%3Acard&limit=5&since=2026-06-01T00%3A00%3A00.000Z`,
        authorization: 'Bearer share-secret',
      },
    ]);
  });

  it('reads as the git history does: the change, who approved it, and the subjects no shape grouped', () => {
    expect(formatRemoteChangelog(CHANGELOG, DEPLOYMENT).split('\n')).toEqual([
      'v1:aaaaaaaaaaaaaaaa Card src/Card.tsx 2  2026-06-02T10:00:00.000Z  builds ci-2, ci-1  by marina, anton',
      '  tighten the card',
      '  note: the border was the point',
      '',
      '1 approved subject(s) no shape could group:',
      '  2026-06-01T10:00:00.000Z  route:/pricing  build ci-1 @ abc123def456  by anton',
      '',
      `note: read from ${DEPLOYMENT}, which recorded these approvals when a reviewer made them`,
    ]);
  });

  it('tells an empty history apart from a filter that matched nothing', () => {
    const empty: RemoteChangelog = { changes: [], ungrouped: [] };
    expect(formatRemoteChangelog(empty, DEPLOYMENT)).toContain(`${DEPLOYMENT} records no approval`);
    expect(formatRemoteChangelog(empty, DEPLOYMENT, { subject: 'story:none' })).toContain(
      'no recorded approval matches that filter',
    );
  });

  it('refuses when no share is stored at the deployment, and names what to declare', async () => {
    const { fetch } = answering(200, CHANGELOG);
    const refused = readRemoteChangelog({ config: config(null), deployment: DEPLOYMENT, fetch });
    await expect(refused).rejects.toThrow(OperatorError);
    await expect(refused).rejects.toThrow(/share token/);
    await expect(refused).rejects.toThrow(/"env"/);
  });

  it('relays a refusal and points at the share token and API 4, because CI sets the share variable to the ingest one', async () => {
    const { fetch } = answering(403, { error: 'CI holds the ingest token' });
    const refused = readRemoteChangelog({ config: config(), deployment: DEPLOYMENT, fetch });
    await expect(refused).rejects.toThrow(/answered 403: CI holds the ingest token/);
    await expect(refused).rejects.toThrow(/the share token/);
    await expect(refused).rejects.toThrow(/API 4/);
  });

  it('names an older deployment by its 404', async () => {
    const { fetch } = answering(404, { error: 'no route' });
    await expect(readRemoteChangelog({ config: config(), deployment: DEPLOYMENT, fetch })).rejects.toThrow(
      /API 4/,
    );
  });
});
