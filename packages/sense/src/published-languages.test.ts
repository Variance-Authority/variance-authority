import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { native } from './addon.js';
import { readPublishedSources, updateSourceIndex } from './test-support/published.js';

it('publishes mixed language edges natively without returning per-file parses to JavaScript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'variance-native-languages-'));
  const at = join(root, '.cache', 'source-index.bin');
  const files = {
    'Cargo.toml': '[package]\nname = "native-fixture"\n',
    'src/lib.rs': 'mod child;\npub fn call() { child::run(); }\n',
    'src/child.rs': 'pub fn run() {}\n',
    'app/main.py': 'from .child import value\n',
    'app/child.py': 'value = 1\n',
    'web/main.ts': "import './style.scss';\nexport const value = 1;\n",
    'web/style.scss': '@use "./colors";\n',
    'web/_colors.scss': '$color: red;\n',
    'jvm/kit/A.java': 'package kit;\npublic class A {}\n',
    'jvm/kit/B.kt': 'package kit\nclass B\n',
    'swift/A.swift': 'public struct A {}\n',
    'swift/B.swift': 'public struct B {}\n',
  };
  const languageReads = vi.spyOn(native()!, 'readLanguage').mockImplementation(() => {
    throw new Error('per-file language bridge entered');
  });
  try {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    const git = (...args: string[]): void => { execFileSync('git', args, { cwd: root }); };
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
    const cold = await updateSourceIndex(root, { index: at });
    expect(cold).toMatchObject({ files: 11, reread: 11, parsed: 11 });
    const { records } = await readPublishedSources(at);
    const edges = (file: string): readonly string[] => records.find((record) => record.file === file)?.edges?.map((edge) => edge.to) ?? [];
    expect(edges('src/lib.rs')).toContain('src/child.rs');
    expect(edges('app/main.py')).toContain('app/child.py');
    expect(edges('web/main.ts')).toContain('web/style.scss');
    expect(edges('web/style.scss')).toContain('web/_colors.scss');
    expect(edges('jvm/kit/A.java')).toContain('jvm/kit/B.kt');
    expect(edges('swift/A.swift')).toContain('swift/B.swift');
    expect(await updateSourceIndex(root, { index: at })).toMatchObject({ files: 11, reread: 0, parsed: 0 });
    // Working-tree reads prove the bytes again and reuse every unchanged parse.
    expect(await updateSourceIndex(root, { index: at, packs: false })).toMatchObject({ files: 11, reread: 11, parsed: 0 });
    expect(await updateSourceIndex(root, { index: at, packs: false })).toMatchObject({ files: 11, reread: 11, parsed: 0 });
    expect(languageReads).not.toHaveBeenCalled();
  } finally {
    languageReads.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
