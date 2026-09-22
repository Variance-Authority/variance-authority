import { readFile, stat } from 'node:fs/promises';
import { decodeExecutionIndex } from '@variance-authority/sense/test-selection';

const file = new URL('.artifacts/journeys.bin', import.meta.url);
const bytes = await readFile(file);
const index = decodeExecutionIndex(bytes);
const crossings = index.modules.reduce(
  (total, module) => total + module.blocks.reduce(
    (moduleTotal, block) => moduleTotal + block.crossings.length,
    0,
  ),
  0,
);

if (index.tests.length !== 1) throw new Error(`expected 1 recorded test, found ${index.tests.length}`);
if (!index.tests[0].id.includes('records the branch it enters')) {
  throw new Error(`unexpected recorded test: ${index.tests[0].id}`);
}
if (!index.modules.some((module) => module.file === 'src/decide.js')) {
  throw new Error('src/decide.js is absent from the recording');
}
if (crossings === 0) throw new Error('the recording contains no test-to-region crossings');

console.log(JSON.stringify({
  bytes: (await stat(file)).size,
  tests: index.tests.length,
  modules: index.modules.length,
  crossings,
  test: index.tests[0].id,
}));
