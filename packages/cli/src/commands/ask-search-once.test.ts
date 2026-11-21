import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

const queried = vi.hoisted(() => [] as string[]);

vi.mock('@variance-authority/help', async (original) => {
  const help = await original<typeof import('@variance-authority/help')>();
  return {
    ...help,
    readSearchForAnswer: async (...args: Parameters<typeof help.readSearchForAnswer>) => {
      const reading = await help.readSearchForAnswer(...args);
      return {
        ...reading,
        index: new Proxy(reading.index, {
          get(target, key, receiver) {
            if (key !== 'namesContaining') return Reflect.get(target, key, receiver);
            return (query: string) => {
              queried.push(query);
              return target.namesContaining(query);
            };
          },
        }),
      };
    },
  };
});

const cwd = process.cwd();
beforeEach(async () => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-search-once-')));
  checkout();
  expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  queried.length = 0;
});
afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

describe('one requested search', () => {
  it.each(['text', 'json'])('queries candidate names once for %s, with or without published matches', async (format) => {
    for (const query of ['greet', 'quasar declaration photon']) {
      queried.length = 0;
      const answer = await run(['ask', 'search', '--query', query, '--format', format]);
      expect(answer.err).toBe('');
      expect(answer.code).toBe(EXIT_CLEAN);
      expect(answer.out.length).toBeGreaterThan(0);
      expect(queried).toEqual([query]);
    }
  });
});
