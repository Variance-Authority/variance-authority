import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from './bin.js';
import { commentMarker } from './commands/comment.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from './exit.js';

/**
 * `variance comment --marker`, the one thing a poster needs from this CLI.
 *
 * A repository running two gates has two configs, and each gate's poster has to
 * find its own comment and not the other's. The config's `project` is what
 * tells them apart, so the marker is read from the config, and a directory with
 * no config gets a refusal rather than a marker no project owns.
 */

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function configFor(project: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'va-comment-marker-'));
  made.push(root);
  const path = join(root, 'variance.config.json');
  await writeFile(
    path,
    JSON.stringify({
      project,
      profile: 'chromium',
      viewport: { width: 1280, height: 800 },
      retention: 'ephemeral',
      subjects: { kind: 'list', ids: ['cart/empty'], collector: './collector.mjs' },
      fonts: [],
    }),
    'utf8',
  );
  return path;
}

async function marker(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(['comment', '--marker', ...argv], {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

describe('comment --marker', () => {
  it("prints the marker of the config's project, one line and nothing else", async () => {
    const tribunal = await marker(['--config', await configFor('tribunal')]);
    const storybook = await marker(['--config', await configFor('storybook-case')]);

    expect(tribunal).toEqual({ code: EXIT_CLEAN, out: `${commentMarker('tribunal')}\n`, err: '' });
    expect(storybook).toEqual({ code: EXIT_CLEAN, out: `${commentMarker('storybook-case')}\n`, err: '' });
    expect(tribunal.out).not.toBe(storybook.out);
  });

  it('refuses where there is no config, because a marker names a project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'va-comment-marker-none-'));
    made.push(root);

    const { code, out } = await marker(['--config', join(root, 'variance.config.json')]);

    expect(code).toBe(EXIT_OPERATOR);
    expect(out).toBe('');
  });
});

describe('commentMarker', () => {
  it("gives each project a marker that no other project's comment carries", () => {
    // Two gates on one pull request, two configs: the poster finds a comment by
    // the marker its body contains, so a marker that contained another's would
    // let one gate rewrite the other's docket. The unkeyed marker every comment
    // carried before markers named their project is not contained either, or
    // the poster asked to adopt an old comment would find a new one.
    const projects = ['storybook-case', 'storybook', 'tribunal', 'a-->b', 'a b', 'a\nb', 'a=b -->'];
    const markers = projects.map(commentMarker);

    for (const [index, marker] of markers.entries()) {
      // One HTML comment on one line, whatever the project is spelled with.
      expect(marker).toMatch(/^<!--[^\n]*-->$/);
      expect(marker.indexOf('-->')).toBe(marker.length - 3);
      expect(marker).not.toContain('<!-- variance-authority: pr-docket v1 -->');
      for (const [other, otherMarker] of markers.entries()) {
        if (other !== index) expect(otherMarker).not.toContain(marker);
      }
    }
  });

  it("spells the project as carry spells it, so a project's comment and its pictures name it alike", () => {
    // encodeURIComponent alone keeps `.` and `'`, which carry writes as bytes,
    // and the two spellings of one project would be two names for it.
    expect(commentMarker('a.b')).toBe('<!-- variance-authority: pr-docket v2 project=a%2Eb -->');
    expect(commentMarker("o'brien (web)")).toBe('<!-- variance-authority: pr-docket v2 project=o%27brien%20%28web%29 -->');
    expect(commentMarker('café')).toBe('<!-- variance-authority: pr-docket v2 project=caf%C3%A9 -->');
  });

  it('refuses a project holding a lone surrogate, which no byte spelling keeps apart from another', () => {
    expect(() => commentMarker('a\ud800')).toThrow(/lone surrogate/);
  });
});
