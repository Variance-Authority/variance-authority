import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { relationsOfFiles, type Relations } from '@variance-authority/core/relate';
import { publishedSelectionGraph } from '../published-selection.js';
import { updateSourceIndex } from '../published.js';
import { distanceFromView } from './distance.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { narrowByExecutionFromView } from './select.js';
import { baseDiff, layerCoverage, layerRecords } from './__fixtures__/layers.js';

let root: string;
let native: Relations;
const newFile = 'src/new.ts';
const records = [...layerRecords.map((record) => record.file === 'src/button/abstract-button.tsx'
  ? { ...record, edges: [{ to: newFile, kind: 'imports' as const }] } : record), {file:newFile}];
const memory = relationsOfFiles(records);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-native-relations-'));
  for (const record of records) {
    const file = join(root, record.file);
    await mkdir(dirname(file), {recursive:true});
    const imports = (record.edges ?? []).map((edge) => {
      const target = relative(dirname(record.file), edge.to);
      const request = target.startsWith('.') ? target : `./${target}`;
      return edge.kind === 'reexports' ? `export * from '${request}';` : `import '${request}';`;
    });
    await writeFile(file, `${imports.join('\n')}\nexport const value = 1;\n`);
  }
  await updateSourceIndex(root);
  native = await publishedSelectionGraph(root, {dirs:['.'],raw:true});
});
afterAll(async () => rm(root, {recursive:true,force:true}));

it('answers nearest measured importers from a retained native frontier', () => {
  const view = openTestCoverage(encodeTestCoverage(layerCoverage));
  const diff = `--- a/${newFile}\n+++ b/${newFile}\n@@ -1,1 +1,1 @@\n-old\n+new`;
  const answer = (relations: Relations) => narrowByExecutionFromView(view, diff, {relations});
  expect(answer(native)).toEqual(answer(memory));
  expect(answer(native).entered).not.toHaveLength(0);
});

it('measures executed paths and entry modules without rebuilding native graph columns', () => {
  const view = openTestCoverage(encodeTestCoverage(layerCoverage));
  const selected = narrowByExecutionFromView(view, baseDiff);
  expect(distanceFromView(view, selected, {relations:native})).toEqual(distanceFromView(view, selected, {relations:memory}));
});
