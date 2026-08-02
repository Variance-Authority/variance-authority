import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DATABASE_VARIABLE,
  HOST_VARIABLE,
  PORT_VARIABLE,
  TOKEN_VARIABLE,
  readConfig,
  start,
} from './bin.js';
import { CHURN_PATH } from '@variance-authority/history';

/**
 * The executable, and the one thing it must never do.
 *
 * Everything here is about refusing. A history service that starts open holds
 * every observation the operator's runs ever produced and answers every question
 * asked of it, successfully, with nothing in its behaviour to suggest anything is
 * wrong. The tests are written against `readConfig` rather than against a spawned
 * process on purpose: a rule that can only be exercised by starting a server is a
 * rule that gets checked once, by hand, before somebody weakens it.
 */

const TOKEN = 'operator-token-long-enough';

const directories: string[] = [];
const running: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const service of running.splice(0)) await service.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'variance-server-'));
  directories.push(directory);
  return directory;
}

describe('configuration', () => {
  it('refuses to start with no token rather than listening without authentication', async () => {
    // The single most important line in the package. An open history is a
    // service that works; a process that exits with a sentence gets fixed.
    expect(() => readConfig({})).toThrow(new RegExp(TOKEN_VARIABLE));
    expect(() => readConfig({ [TOKEN_VARIABLE]: '   ' })).toThrow(/will not start without one/);
  });

  it('refuses a token too short to be a secret', async () => {
    // "Set a token" is satisfied to the letter by `dev`, which is an open service
    // with a formality in front of it.
    expect(() => readConfig({ [TOKEN_VARIABLE]: 'dev' })).toThrow(/at least 16/);
  });

  it('defaults to loopback and to an absolute database path', async () => {
    // Binding every interface by default is one firewall mistake away from a
    // public record of an unreleased product; and a relative database path is a
    // history written into whatever directory the service was launched from.
    const config = readConfig({ [TOKEN_VARIABLE]: TOKEN });

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(7788);
    expect(isAbsolute(config.database)).toBe(true);
  });

  it('takes the port, host and database from the environment when they are set', async () => {
    const config = readConfig({
      [TOKEN_VARIABLE]: TOKEN,
      [PORT_VARIABLE]: '9001',
      [HOST_VARIABLE]: '0.0.0.0',
      [DATABASE_VARIABLE]: '/srv/history.db',
    });

    expect(config).toEqual({
      port: 9001,
      host: '0.0.0.0',
      database: '/srv/history.db',
      token: TOKEN,
    });
  });

  it('refuses a port that is not a port instead of falling back to a default', async () => {
    // A typo that silently became 7788 would leave the operator's reverse proxy
    // pointing at nothing, with the service reporting success.
    expect(() => readConfig({ [TOKEN_VARIABLE]: TOKEN, [PORT_VARIABLE]: 'https' })).toThrow(
      new RegExp(PORT_VARIABLE),
    );
    expect(() => readConfig({ [TOKEN_VARIABLE]: TOKEN, [PORT_VARIABLE]: '70000' })).toThrow(
      new RegExp(PORT_VARIABLE),
    );
  });
});

describe('starting', () => {
  it('opens the configured database, serves it, and names the file it is writing', async () => {
    // The startup line is the only way an operator can confirm the service is
    // writing where they think it is — and it must not carry the token.
    const path = join(scratch(), 'history.db');
    const lines: string[] = [];

    const service = await start(
      { [TOKEN_VARIABLE]: TOKEN, [PORT_VARIABLE]: '0', [DATABASE_VARIABLE]: path },
      (line) => lines.push(line),
    );
    running.push(service);

    expect(lines.join('')).toContain(path);
    expect(lines.join('')).not.toContain(TOKEN);

    const answered = await fetch(`${service.url}${CHURN_PATH}?component=Button`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(answered.status).toBe(200);

    const refused = await fetch(`${service.url}${CHURN_PATH}?component=Button`);
    expect(refused.status).toBe(401);
  });
});
