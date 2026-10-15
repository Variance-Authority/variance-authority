import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatTypescript, typescriptFinding } from './doctor-typescript.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('formatTypescript', () => {
  it('suggests turning the tsconfig off when no config in the repository adds a condition or maps a path', () => {
    const text = formatTypescript({ under: '', declared: undefined, configs: ['tsconfig.json'], conditioned: [], mapped: [], based: [] }).join('\n');

    expect(text).toContain('typescript: tsconfig auto, the default');
    expect(text).toContain('1 tsconfig file in the repository; 0 add conditions, 0 map paths');
    expect(text).toContain('"typescript": { "tsconfig": false }');
    expect(text).toContain('stops every scan reading one for paths, baseUrl or conditions');
  });

  it('names each config a resolution needs, and suggests nothing', () => {
    const text = formatTypescript({
      under: '',
      declared: 'auto',
      configs: ['packages/app/tsconfig.json', 'tsconfig.base.json'],
      conditioned: ['packages/app/tsconfig.json', 'tsconfig.base.json'],
      mapped: ['tsconfig.base.json'],
      based: [],
    }).join('\n');

    expect(text).toContain('typescript: tsconfig auto\n');
    expect(text).toContain('2 tsconfig files in the repository; 2 add conditions, 1 maps paths');
    expect(text).toContain('  packages/app/tsconfig.json: customConditions\n  tsconfig.base.json: customConditions, paths');
    expect(text).not.toContain('"tsconfig": false');
  });

  it('suggests nothing when a config resolves through baseUrl alone', () => {
    const text = formatTypescript({
      under: '',
      declared: undefined,
      configs: ['tsconfig.json'],
      conditioned: [],
      mapped: [],
      based: ['tsconfig.json'],
    }).join('\n');

    expect(text).toContain('1 tsconfig file in the repository; 0 add conditions, 0 map paths, 1 sets baseUrl');
    expect(text).toContain('  tsconfig.json: baseUrl');
    expect(text).not.toContain('"tsconfig": false');
  });

  it('warns when the tsconfig is off and a config asks for what is then not read', () => {
    const text = formatTypescript({ under: '', declared: false, configs: ['tsconfig.json'], conditioned: ['tsconfig.json'], mapped: [], based: [] }).join('\n');

    expect(text).toContain('typescript: tsconfig off');
    expect(text).toContain('no scan reads them for paths, baseUrl or conditions');
  });

  it('names the config the root config names', () => {
    const text = formatTypescript({
      under: '',
      declared: 'tsconfig.app.json',
      configs: ['tsconfig.app.json'],
      conditioned: ['tsconfig.app.json'],
      mapped: [],
      based: [],
    }).join('\n');

    expect(text).toContain('typescript: tsconfig tsconfig.app.json');
    expect(text).not.toContain('"tsconfig": false');
  });

  it('suggests nothing for a directory whose configs ask nothing, when configs elsewhere in the repository do', () => {
    const text = formatTypescript({
      under: 'jira',
      declared: undefined,
      configs: ['confluence/tsconfig.json', 'jira/tsconfig.json'],
      governing: ['jira/tsconfig.json'],
      conditioned: [],
      mapped: ['confluence/tsconfig.json'],
      based: [],
    }).join('\n');

    expect(text).toContain('2 tsconfig files in the repository; 0 add conditions, 1 maps paths');
    expect(text).toContain('1 of them can govern jira; 0 add conditions, 0 map paths');
    expect(text).toContain('none that can govern jira asks; `false` reaches the whole repository, so it would stop the 1 that do as well');
    expect(text).not.toContain('"tsconfig": false');
  });

  it('lists the configs that govern the directory before the rest', () => {
    const text = formatTypescript({
      under: 'jira',
      declared: undefined,
      configs: ['confluence/tsconfig.json', 'jira/tsconfig.json'],
      governing: ['jira/tsconfig.json'],
      conditioned: [],
      mapped: ['confluence/tsconfig.json', 'jira/tsconfig.json'],
      based: [],
    }).join('\n');

    expect(text).toContain('  jira/tsconfig.json: paths\n  confluence/tsconfig.json: paths');
    expect(text).not.toContain('none that can govern');
  });

  it('lists ten configs and counts the rest', () => {
    const configs = Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(2, '0')}/tsconfig.json`);
    const lines = formatTypescript({ under: '', declared: undefined, configs, conditioned: [], mapped: configs, based: [] });

    expect(lines.filter((line) => line.endsWith(': paths'))).toHaveLength(10);
    expect(lines).toContain('  and 2 more');
  });

  it('says no config was read where git gave no listing', () => {
    expect(formatTypescript({ under: '', declared: undefined, conditioned: [], mapped: [], based: [] }).join('\n')).toContain('git gave no listing here');
  });

  it('prints a refused root config rather than failing the diagnosis', () => {
    const text = formatTypescript({ refused: 'variance.config.json: "typescript.tsconfig" names x.json, which is not a file' }).join('\n');

    expect(text).toBe('typescript: REFUSED\n  variance.config.json: "typescript.tsconfig" names x.json, which is not a file');
  });
});

describe('typescriptFinding', () => {
  it('holds a refusal of the root config as the finding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'va-doctor-typescript-'));
    roots.push(root);
    execFileSync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ typescript: { tsconfig: 'tsconfig.app.json' } }));

    expect(await typescriptFinding(root)).toEqual({ refused: expect.stringMatching(/tsconfig\.app\.json, which is not a file/u) });
  });
});
